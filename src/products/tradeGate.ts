/**
 * trade-gate: "May I swap X of A for B on HSKSwap within N bps of price
 * impact?" Gathers mainnet evidence, then hands it to the pure rules.
 */
import type { Address } from "viem";

import { HSKSWAP, POLICY } from "../config.js";
import { bps, chainTip, findPools, oracleUsd, poolState, quote, resolveToken, sqrtPriceToPrice, tickToPrice, toHuman, toRaw, twapTick } from "../hsk/market.js";
import { tradeGate as rule } from "../verdict/rules.js";
import type { ProductResult } from "./types.js";

export interface TradeGateQuery {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  maxImpactBps: number;
}

export function parseTradeGateQuery(q: URLSearchParams): TradeGateQuery {
  const tokenIn = q.get("tokenIn") ?? q.get("in") ?? "";
  const tokenOut = q.get("tokenOut") ?? q.get("out") ?? "";
  const amountIn = q.get("amountIn") ?? q.get("amount") ?? "";
  const maxImpactBps = Number(q.get("maxImpactBps") ?? POLICY.defaultMaxImpactBps);
  if (!tokenIn || !tokenOut) throw new Error("trade-gate needs tokenIn and tokenOut, for example tokenIn=USDT&tokenOut=WHSK");
  if (tokenIn.toUpperCase() === tokenOut.toUpperCase()) throw new Error("tokenIn and tokenOut must differ");
  if (!/^\d+(\.\d+)?$/.test(amountIn) || Number(amountIn) <= 0) throw new Error("amountIn must be a positive decimal, for example amountIn=300");
  if (!Number.isInteger(maxImpactBps) || maxImpactBps < 1 || maxImpactBps > 5000) throw new Error("maxImpactBps must be a whole number from 1 to 5000");
  return { tokenIn, tokenOut, amountIn, maxImpactBps };
}

/** Pick the fee tier that pays out the most for this size. */
async function bestPool(tokenIn: Address, tokenOut: Address, amountRaw: bigint) {
  const pools = await findPools(tokenIn, tokenOut);
  const quoted = await Promise.all(pools.map(async p => ({ ...p, out: await quote(tokenIn, tokenOut, p.fee, amountRaw) })));
  return quoted.filter(p => p.out !== null && p.out > 0n).sort((a, b) => (b.out! > a.out! ? 1 : -1))[0] ?? null;
}

export async function tradeGate(q: TradeGateQuery): Promise<ProductResult> {
  const [tokenIn, tokenOut, tip] = await Promise.all([resolveToken(q.tokenIn), resolveToken(q.tokenOut), chainTip()]);
  const amountRaw = toRaw(q.amountIn, tokenIn.decimals);
  const pool = await bestPool(tokenIn.address, tokenOut.address, amountRaw);
  const sources: ProductResult["sources"] = [{ type: "chain-tip", ref: "eth_getBlockByNumber latest", blockNumber: tip.number }];

  if (!pool) {
    const ruling = rule({ blockAgeSec: tip.ageSec, quoteAvailable: false, impactBps: null, maxImpactBps: q.maxImpactBps, twapDeviationBps: null, oracleDeviationBps: null, oracleAgeSec: null, recommendedAmountIn: null, amountIn: q.amountIn });
    return { ...ruling, blockNumber: tip.number, sources, data: { tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn: q.amountIn, checks: ruling.checks } };
  }

  const state = await poolState(pool.address);
  const inIsToken0 = state.token0.toLowerCase() === tokenIn.address.toLowerCase();
  const [dec0, dec1] = inIsToken0 ? [tokenIn.decimals, tokenOut.decimals] : [tokenOut.decimals, tokenIn.decimals];
  const price0in1 = sqrtPriceToPrice(state.sqrtPriceX96, dec0, dec1);
  const outPerIn = inIsToken0 ? price0in1 : 1 / price0in1;

  const amountOut = Number(toHuman(pool.out!, tokenOut.decimals));
  const midOut = Number(q.amountIn) * outPerIn * (1 - pool.fee / 1_000_000);
  const impactBps = Math.max(0, Math.round((1 - amountOut / midOut) * 10_000));

  const [twap, oracleIn, oracleOut] = await Promise.all([
    twapTick(pool.address),
    tokenIn.usdFeed ? oracleUsd(tokenIn.usdFeed) : Promise.resolve(null),
    tokenOut.usdFeed ? oracleUsd(tokenOut.usdFeed) : Promise.resolve(null),
  ]);
  const twapOutPerIn = twap === null ? null : inIsToken0 ? tickToPrice(twap, dec0, dec1) : 1 / tickToPrice(twap, dec0, dec1);
  const twapDeviationBps = twapOutPerIn === null ? null : bps(outPerIn, twapOutPerIn);
  const oracleOutPerIn = oracleIn && oracleOut ? oracleIn.usd / oracleOut.usd : null;
  const oracleDeviationBps = oracleOutPerIn === null ? null : bps(outPerIn, oracleOutPerIn);
  const oracleAgeSec = oracleIn && oracleOut ? Math.max(oracleIn.ageSec, oracleOut.ageSec) : null;

  const recommendedAmountIn = impactBps > q.maxImpactBps
    ? await largestSizeWithin(tokenIn.address, tokenOut.address, pool.fee, amountRaw, tokenIn.decimals, tokenOut.decimals, outPerIn, q.maxImpactBps)
    : null;

  const ruling = rule({ blockAgeSec: tip.ageSec, quoteAvailable: true, impactBps, maxImpactBps: q.maxImpactBps, twapDeviationBps, oracleDeviationBps, oracleAgeSec, recommendedAmountIn, amountIn: q.amountIn });

  sources.push(
    { type: "hskswap-quoter-v2", ref: HSKSWAP.quoterV2, blockNumber: tip.number },
    { type: "hskswap-pool", ref: pool.address, blockNumber: tip.number, note: `fee tier ${pool.fee / 10_000}%` },
  );
  if (twap !== null) sources.push({ type: "pool-twap", ref: pool.address, blockNumber: tip.number, note: `${POLICY.twapWindowSec}s window` });
  if (oracleIn) sources.push({ type: "apro-oracle", ref: oracleIn.feed, observedAt: new Date(oracleIn.updatedAt * 1000).toISOString(), note: `${tokenIn.symbol}/USD` });
  if (oracleOut) sources.push({ type: "apro-oracle", ref: oracleOut.feed, observedAt: new Date(oracleOut.updatedAt * 1000).toISOString(), note: `${tokenOut.symbol}/USD` });

  return {
    ...ruling,
    blockNumber: tip.number,
    sources,
    data: {
      tokenIn: { symbol: tokenIn.symbol, address: tokenIn.address },
      tokenOut: { symbol: tokenOut.symbol, address: tokenOut.address },
      amountIn: q.amountIn,
      quotedAmountOut: round(amountOut, 6),
      pool: { address: pool.address, feeTier: pool.fee },
      spotPrice: round(outPerIn, 10),
      twapPrice: twapOutPerIn === null ? null : round(twapOutPerIn, 10),
      oraclePrice: oracleOutPerIn === null ? null : round(oracleOutPerIn, 10),
      priceUnit: `${tokenOut.symbol} per ${tokenIn.symbol}`,
      priceImpactBps: impactBps,
      maxImpactBps: q.maxImpactBps,
      hardImpactBps: POLICY.hardImpactBps,
      twapDeviationBps,
      oracleDeviationBps,
      oracleAgeSec,
      recommendedAmountIn,
      blockAgeSec: tip.ageSec,
      checks: ruling.checks,
      note: "Price impact is the move this trade causes. Slippage protection is still set on the swap itself.",
    },
  };
}

/** Binary search on live quotes for the largest size within the impact limit. */
async function largestSizeWithin(tokenIn: Address, tokenOut: Address, fee: number, maxRaw: bigint, decIn: number, decOut: number, outPerIn: number, limitBps: number): Promise<string | null> {
  let lo = 0n;
  let hi = maxRaw;
  for (let i = 0; i < 12 && hi - lo > maxRaw / 1000n; i++) {
    const mid = (lo + hi) / 2n;
    const out = await quote(tokenIn, tokenOut, fee, mid);
    if (out === null) { hi = mid; continue; }
    const midHuman = Number(toHuman(mid, decIn));
    const impact = (1 - Number(toHuman(out, decOut)) / (midHuman * outPerIn * (1 - fee / 1_000_000))) * 10_000;
    if (impact <= limitBps) lo = mid; else hi = mid;
  }
  if (lo === 0n) return null;
  // Round down to two significant digits so the suggestion reads like a size a person would pick.
  const human = Number(toHuman(lo, decIn));
  const magnitude = Math.pow(10, Math.floor(Math.log10(human)) - 1);
  return String(Math.floor(human / magnitude) * magnitude);
}

const round = (n: number, places: number) => Number(n.toFixed(places));
