/**
 * Supporting market SKUs: pool-depth, price-sanity and chain-status. Each
 * returns evidence with verdict INFO; trade-gate is the one that decides.
 */
import { HSKSWAP, POLICY } from "../config.js";
import { mainnet } from "../hsk/client.js";
import { bps, chainTip, findPools, oracleUsd, poolState, quote, resolveToken, sqrtPriceToPrice, tickToPrice, toHuman, toRaw, twapTick } from "../hsk/market.js";
import type { ProductResult } from "./types.js";

export interface PairQuery {
  tokenA: string;
  tokenB: string;
  amount?: string;
}

export function parsePairQuery(q: URLSearchParams): PairQuery {
  const tokenA = q.get("tokenA") ?? q.get("tokenIn") ?? "";
  const tokenB = q.get("tokenB") ?? q.get("tokenOut") ?? "";
  if (!tokenA || !tokenB) throw new Error("needs tokenA and tokenB, for example tokenA=USDT&tokenB=WHSK");
  const amount = q.get("amount") ?? undefined;
  if (amount !== undefined && (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0)) throw new Error("amount must be a positive decimal");
  return { tokenA, tokenB, amount };
}

async function deepestPool(a: string, b: string) {
  const [tokenA, tokenB] = await Promise.all([resolveToken(a), resolveToken(b)]);
  const pools = await findPools(tokenA.address, tokenB.address);
  if (!pools.length) throw new Error(`no HSKSwap pool for ${tokenA.symbol}/${tokenB.symbol}`);
  const states = await Promise.all(pools.map(p => poolState(p.address)));
  const state = states.sort((x, y) => (y.liquidity > x.liquidity ? 1 : -1))[0];
  const aIs0 = state.token0.toLowerCase() === tokenA.address.toLowerCase();
  return { tokenA, tokenB, state, aIs0, pools };
}

export async function poolDepth(q: PairQuery): Promise<ProductResult> {
  const tip = await chainTip();
  const { tokenA, tokenB, state, aIs0, pools } = await deepestPool(q.tokenA, q.tokenB);
  const [dec0, dec1] = aIs0 ? [tokenA.decimals, tokenB.decimals] : [tokenB.decimals, tokenA.decimals];
  const price0in1 = sqrtPriceToPrice(state.sqrtPriceX96, dec0, dec1);
  const bPerA = aIs0 ? price0in1 : 1 / price0in1;
  const reserveA = Number(toHuman(aIs0 ? state.balance0 : state.balance1, tokenA.decimals));
  const reserveB = Number(toHuman(aIs0 ? state.balance1 : state.balance0, tokenB.decimals));

  let sizeQuote: Record<string, unknown> | null = null;
  if (q.amount) {
    const out = await quote(tokenA.address, tokenB.address, state.fee, toRaw(q.amount, tokenA.decimals));
    if (out !== null) {
      const outHuman = Number(toHuman(out, tokenB.decimals));
      const impact = Math.max(0, Math.round((1 - outHuman / (Number(q.amount) * bPerA * (1 - state.fee / 1e6))) * 10_000));
      sizeQuote = { amountIn: q.amount, quotedAmountOut: Number(outHuman.toFixed(6)), priceImpactBps: impact };
    }
  }

  return {
    verdict: "INFO",
    reasons: [`Deepest ${tokenA.symbol}/${tokenB.symbol} pool holds ${fmt(reserveA)} ${tokenA.symbol} and ${fmt(reserveB)} ${tokenB.symbol}.`],
    blockNumber: tip.number,
    sources: [
      { type: "hskswap-pool", ref: state.address, blockNumber: tip.number },
      { type: "hskswap-factory", ref: HSKSWAP.factory, blockNumber: tip.number, note: `${pools.length} fee tier(s) found` },
    ],
    data: {
      pool: { address: state.address, feeTier: state.fee, tick: state.tick, sqrtPriceX96: state.sqrtPriceX96.toString(), liquidity: state.liquidity.toString() },
      reserves: { [tokenA.symbol]: fmt(reserveA), [tokenB.symbol]: fmt(reserveB) },
      spotPrice: Number(bPerA.toPrecision(10)),
      priceUnit: `${tokenB.symbol} per ${tokenA.symbol}`,
      sizeQuote,
      otherFeeTiers: pools.filter(p => p.address !== state.address).map(p => ({ address: p.address, feeTier: p.fee })),
      note: "Reserves are token balances held by the pool. Executable depth depends on where liquidity sits around the current tick, which is why sizeQuote uses the live quoter.",
    },
  };
}

export async function priceSanity(q: PairQuery): Promise<ProductResult> {
  const tip = await chainTip();
  const { tokenA, tokenB, state, aIs0 } = await deepestPool(q.tokenA, q.tokenB);
  const [dec0, dec1] = aIs0 ? [tokenA.decimals, tokenB.decimals] : [tokenB.decimals, tokenA.decimals];
  const orient = (p0in1: number) => (aIs0 ? p0in1 : 1 / p0in1);
  const spot = orient(sqrtPriceToPrice(state.sqrtPriceX96, dec0, dec1));
  const tw = await twapTick(state.address);
  const twap = tw === null ? null : orient(tickToPrice(tw, dec0, dec1));
  const [oa, ob] = await Promise.all([
    tokenA.usdFeed ? oracleUsd(tokenA.usdFeed) : Promise.resolve(null),
    tokenB.usdFeed ? oracleUsd(tokenB.usdFeed) : Promise.resolve(null),
  ]);
  const oracle = oa && ob ? oa.usd / ob.usd : null;
  const twapDev = twap === null ? null : bps(spot, twap);
  const oracleDev = oracle === null ? null : bps(spot, oracle);
  const flagged = (twapDev ?? 0) > POLICY.maxTwapDeviationBps || (oracleDev ?? 0) > POLICY.maxOracleDeviationBps;

  const sources: ProductResult["sources"] = [{ type: "hskswap-pool", ref: state.address, blockNumber: tip.number }];
  if (oa) sources.push({ type: "apro-oracle", ref: oa.feed, observedAt: new Date(oa.updatedAt * 1000).toISOString(), note: `${tokenA.symbol}/USD` });
  if (ob) sources.push({ type: "apro-oracle", ref: ob.feed, observedAt: new Date(ob.updatedAt * 1000).toISOString(), note: `${tokenB.symbol}/USD` });

  return {
    verdict: "INFO",
    reasons: [flagged
      ? `Pool price disagrees with its references beyond policy (TWAP ${twapDev ?? "n/a"} bps, oracle ${oracleDev ?? "n/a"} bps).`
      : `Pool price agrees with its references (TWAP ${twapDev ?? "n/a"} bps, oracle ${oracleDev ?? "n/a"} bps).`],
    blockNumber: tip.number,
    sources,
    data: {
      priceUnit: `${tokenB.symbol} per ${tokenA.symbol}`,
      spot: Number(spot.toPrecision(10)),
      twap10m: twap === null ? null : Number(twap.toPrecision(10)),
      oracle: oracle === null ? null : Number(oracle.toPrecision(10)),
      oracleUsd: { [tokenA.symbol]: oa?.usd ?? null, [tokenB.symbol]: ob?.usd ?? null },
      oracleAgeSec: oa && ob ? Math.max(oa.ageSec, ob.ageSec) : null,
      twapDeviationBps: twapDev,
      oracleDeviationBps: oracleDev,
      limits: { twapBps: POLICY.maxTwapDeviationBps, oracleBps: POLICY.maxOracleDeviationBps },
      flagged,
    },
  };
}

export async function chainStatus(): Promise<ProductResult> {
  const [tip, gasPrice] = await Promise.all([chainTip(), mainnet.getGasPrice()]);
  const fresh = tip.ageSec <= POLICY.maxBlockAgeSec;
  return {
    verdict: "INFO",
    reasons: [fresh ? `HSK Chain is live. Latest block ${tip.number} is ${tip.ageSec}s old.` : `Latest block is ${tip.ageSec}s old. Treat chain data as stale.`],
    blockNumber: tip.number,
    sources: [{ type: "rpc", ref: "eth_getBlockByNumber, eth_gasPrice", blockNumber: tip.number }],
    data: { chainId: 177, latestBlock: tip.number, blockTimestamp: tip.timestamp, blockAgeSec: tip.ageSec, fresh, gasPriceGwei: Number((Number(gasPrice) / 1e9).toFixed(4)) },
  };
}

const fmt = (n: number) => Number(n.toPrecision(6));
