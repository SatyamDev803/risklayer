/**
 * Network constants and environment. Every address here was read from HSK
 * Chain mainnet (chain 177) or the HSP onboarding table; testnet addresses
 * are only used for the HSP payment leg, never for market data.
 */
import "dotenv/config";
import type { Address } from "viem";

export const HSK_MAINNET = {
  id: 177,
  rpc: process.env.HSK_RPC_URL?.trim() || "https://mainnet.hsk.xyz",
  explorer: "https://hsk.blockscout.com",
} as const;

export const HSK_TESTNET = {
  id: 133,
  rpc: process.env.HSK_TESTNET_RPC_URL?.trim() || "https://testnet.hsk.xyz",
  explorer: "https://testnet-explorer.hskchain.net",
} as const;

/** Ethereum Sepolia: only for the payment leg, with Circle's test USDC
 * (the organizers' recommended test token). HSP itself does not settle here. */
export const ETH_SEPOLIA = {
  id: 11155111,
  rpc: process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com",
  explorer: "https://sepolia.etherscan.io",
} as const;

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
  /** APRO USD feed on mainnet, when one exists. */
  usdFeed?: Address;
}

/** Tokens the market-data SKUs understand by symbol. */
export const TOKENS: Record<string, TokenInfo> = {
  WHSK: { symbol: "WHSK", address: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1", decimals: 18, usdFeed: "0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b" },
  USDT: { symbol: "USDT", address: "0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029", decimals: 6, usdFeed: "0x823d7f90f7A3498DB6595886b6B5dC95E6B0B7f3" },
  USDC: { symbol: "USDC.e", address: "0x054ed45810DbBAb8B27668922D110669c9D88D0a", decimals: 6, usdFeed: "0x244Ce344df8837c9d938867E2Ffbf0E4B0169B56" },
  WETH: { symbol: "WETH", address: "0xefd4bC9afD210517803f293ABABd701CaeeCdfd0", decimals: 18 },
  WBTC: { symbol: "WBTC", address: "0x6119ca49a79f5825c8b345f8d7ac36b272565b14", decimals: 8, usdFeed: "0x204ED500ab56A2E19B051561258E3A45c850360F" },
};

export const HSKSWAP = {
  factory: "0x972cA9D1662F5e029cD18327D29026532E84c742",
  quoterV2: "0x603f70466fDdbE3F238220B9a74FFF419a2BbFDD",
  swapRouter02: "0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3",
  feeTiers: [100, 500, 3000, 10000],
} as const satisfies { factory: Address; quoterV2: Address; swapRouter02: Address; feeTiers: readonly number[] };

/** Payment tokens HSP accepts with EIP-3009 (the leg the agent signs). */
export const PAYMENT_TOKENS = {
  hashkey: { network: "hashkey", chainId: 177, coin: "USDC", address: "0x054ed45810DbBAb8B27668922D110669c9D88D0a", decimals: 6, eip712: { name: "Bridged USDC", version: "2" }, rpc: HSK_MAINNET.rpc, explorer: HSK_MAINNET.explorer },
  "hashkey-testnet": { network: "hashkey-testnet", chainId: 133, coin: "USDC", address: "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6", decimals: 6, eip712: { name: process.env.TESTNET_USDC_EIP712_NAME?.trim() || "USD Coin", version: process.env.TESTNET_USDC_EIP712_VERSION?.trim() || "2" }, rpc: HSK_TESTNET.rpc, explorer: HSK_TESTNET.explorer },
  sepolia: { network: "sepolia", chainId: 11155111, coin: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6, eip712: { name: "USDC", version: "2" }, rpc: ETH_SEPOLIA.rpc, explorer: ETH_SEPOLIA.explorer },
} as const;

export type PaymentNetwork = keyof typeof PAYMENT_TOKENS;

/** Explorer for a payment-leg chain id; market data and receipts are always on mainnet. */
export const paymentExplorer = (chainId: number): string =>
  Object.values(PAYMENT_TOKENS).find(t => t.chainId === chainId)?.explorer ?? HSK_MAINNET.explorer;

export function paymentNetwork(): PaymentNetwork {
  const value = (process.env.PAYMENT_NETWORK ?? "hashkey-testnet").trim();
  if (!(value in PAYMENT_TOKENS)) throw new Error(`PAYMENT_NETWORK must be one of ${Object.keys(PAYMENT_TOKENS).join(", ")}, got '${value}'`);
  return value as PaymentNetwork;
}

/** `hsp` talks to HashKey's merchant API; `local` uses the HSP-compatible
 * gateway mounted at /hsp-local. Local mode is labelled everywhere. */
export type HspMode = "hsp" | "local";

export function hspMode(): HspMode {
  return (process.env.HSP_MODE ?? "local").trim() === "hsp" ? "hsp" : "local";
}

/** Verdict policy. Thresholds and their order are documented in README.md. */
export const POLICY = {
  defaultMaxImpactBps: Number(process.env.POLICY_MAX_IMPACT_BPS ?? 100),
  hardImpactBps: Number(process.env.POLICY_HARD_IMPACT_BPS ?? 1500),
  maxTwapDeviationBps: Number(process.env.POLICY_MAX_TWAP_DEV_BPS ?? 200),
  maxOracleDeviationBps: Number(process.env.POLICY_MAX_ORACLE_DEV_BPS ?? 300),
  maxOracleAgeSec: Number(process.env.POLICY_MAX_ORACLE_AGE_SEC ?? 86_400),
  maxBlockAgeSec: Number(process.env.POLICY_MAX_BLOCK_AGE_SEC ?? 60),
  twapWindowSec: 600,
} as const;
