/**
 * Read-only HSKSwap and oracle evidence from HSK mainnet. Nothing here
 * spends gas: QuoterV2 is simulated via eth_call, everything else is a view.
 */
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";

import { HSKSWAP, POLICY, TOKENS, type TokenInfo } from "../config.js";
import { abis, mainnet } from "./client.js";

export async function resolveToken(input: string): Promise<TokenInfo> {
  const key = input.trim().toUpperCase().replace(/\.E$/, "");
  if (TOKENS[key]) return TOKENS[key];
  if (!isAddress(input)) throw new Error(`unknown token '${input}': use WHSK, USDT, USDC, WETH, WBTC or a 0x address`);
  const known = Object.values(TOKENS).find(t => t.address.toLowerCase() === input.toLowerCase());
  if (known) return known;
  const address = getAddress(input);
  const [symbol, decimals] = await Promise.all([
    mainnet.readContract({ address, abi: abis.erc20, functionName: "symbol" }),
    mainnet.readContract({ address, abi: abis.erc20, functionName: "decimals" }),
  ]);
  return { symbol, address, decimals };
}

export interface ChainTip {
  number: number;
  timestamp: number;
  ageSec: number;
}

export async function chainTip(): Promise<ChainTip> {
  const block = await mainnet.getBlock({ blockTag: "latest" });
  const timestamp = Number(block.timestamp);
  return { number: Number(block.number), timestamp, ageSec: Math.max(0, Math.round(Date.now() / 1000 - timestamp)) };
}

export async function findPools(a: Address, b: Address): Promise<{ address: Address; fee: number }[]> {
  const found = await Promise.all(
    HSKSWAP.feeTiers.map(async fee => ({
      fee,
      address: await mainnet.readContract({ address: HSKSWAP.factory, abi: abis.factory, functionName: "getPool", args: [a, b, fee] }),
    })),
  );
  return found.filter(p => p.address !== zeroAddress);
}

export async function quote(tokenIn: Address, tokenOut: Address, fee: number, amountIn: bigint): Promise<bigint | null> {
  if (amountIn <= 0n) return 0n;
  try {
    const { result } = await mainnet.simulateContract({
      address: HSKSWAP.quoterV2,
      abi: abis.quoterV2,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  } catch {
    return null;
  }
}

export interface PoolState {
  address: Address;
  fee: number;
  token0: Address;
  token1: Address;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  balance0: bigint;
  balance1: bigint;
}

export async function poolState(address: Address): Promise<PoolState> {
  const [slot0, liquidity, token0, token1, fee] = await Promise.all([
    mainnet.readContract({ address, abi: abis.pool, functionName: "slot0" }),
    mainnet.readContract({ address, abi: abis.pool, functionName: "liquidity" }),
    mainnet.readContract({ address, abi: abis.pool, functionName: "token0" }),
    mainnet.readContract({ address, abi: abis.pool, functionName: "token1" }),
    mainnet.readContract({ address, abi: abis.pool, functionName: "fee" }),
  ]);
  const [balance0, balance1] = await Promise.all([
    mainnet.readContract({ address: token0, abi: abis.erc20, functionName: "balanceOf", args: [address] }),
    mainnet.readContract({ address: token1, abi: abis.erc20, functionName: "balanceOf", args: [address] }),
  ]);
  return { address, fee, token0, token1, sqrtPriceX96: slot0[0], tick: slot0[1], liquidity, balance0, balance1 };
}

/** Average tick over the window, or null when the pool cannot answer
 * (not enough observations stored). */
export async function twapTick(address: Address, windowSec = POLICY.twapWindowSec): Promise<number | null> {
  try {
    const [cumulatives] = await mainnet.readContract({ address, abi: abis.pool, functionName: "observe", args: [[windowSec, 0]] });
    return Math.floor(Number(cumulatives[1] - cumulatives[0]) / windowSec);
  } catch {
    return null;
  }
}

/** Price of token0 denominated in token1, in human units. */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function sqrtPriceToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return ratio * ratio * Math.pow(10, decimals0 - decimals1);
}

export interface OracleReading {
  feed: Address;
  usd: number;
  updatedAt: number;
  ageSec: number;
}

export async function oracleUsd(feed: Address): Promise<OracleReading | null> {
  try {
    const [round, decimals] = await Promise.all([
      mainnet.readContract({ address: feed, abi: abis.aggregator, functionName: "latestRoundData" }),
      mainnet.readContract({ address: feed, abi: abis.aggregator, functionName: "decimals" }),
    ]);
    const updatedAt = Number(round[3]);
    return { feed, usd: Number(formatUnits(round[1], decimals)), updatedAt, ageSec: Math.max(0, Math.round(Date.now() / 1000 - updatedAt)) };
  } catch {
    return null;
  }
}

export const toRaw = (amount: string, decimals: number) => parseUnits(amount, decimals);
export const toHuman = (raw: bigint, decimals: number) => formatUnits(raw, decimals);

export const bps = (a: number, b: number) => (b === 0 ? Infinity : Math.round(Math.abs(a - b) / b * 10_000));
