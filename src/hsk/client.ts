import { createPublicClient, defineChain, http, parseAbi, type Chain } from "viem";

import { HSK_MAINNET, HSK_TESTNET } from "../config.js";

export const hskMainnet: Chain = defineChain({
  id: HSK_MAINNET.id,
  name: "HashKey Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [HSK_MAINNET.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: HSK_MAINNET.explorer } },
});

export const hskTestnet: Chain = defineChain({
  id: HSK_TESTNET.id,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [HSK_TESTNET.rpc] } },
  blockExplorers: { default: { name: "Explorer", url: HSK_TESTNET.explorer } },
  testnet: true,
});

export const chainById = (id: number): Chain => (id === HSK_TESTNET.id ? hskTestnet : hskMainnet);

export const mainnet = createPublicClient({ chain: hskMainnet, transport: http(HSK_MAINNET.rpc, { timeout: 10_000, retryCount: 2 }) });

export const abis = {
  erc20: parseAbi([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ]),
  eip3009: parseAbi([
    "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
    "function authorizationState(address authorizer,bytes32 nonce) view returns (bool)",
  ]),
  factory: parseAbi(["function getPool(address,address,uint24) view returns (address)"]),
  pool: parseAbi([
    "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
    "function liquidity() view returns (uint128)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function fee() view returns (uint24)",
    "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)",
  ]),
  quoterV2: parseAbi([
    "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  ]),
  swapRouter02: parseAbi([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  ]),
  aggregator: parseAbi([
    "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
    "function decimals() view returns (uint8)",
  ]),
};
