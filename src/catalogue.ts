/**
 * The paid catalogue. Prices are USD, settled in USDC through HSP. Every SKU
 * is one GET: the buyer is a machine, so there is no signup and no API key.
 */
export interface Sku {
  id: string;
  title: string;
  question: string;
  description: string;
  /** USD price, two decimals, as HSP expects in `details.total`. */
  priceUsd: string;
  example: string;
  /** Agents that decide (trade-gate, pay-gate) vs evidence-only SKUs. */
  decides: boolean;
}

export const SKUS: Sku[] = [
  {
    id: "trade-gate",
    title: "Trade gate",
    question: "May I make this swap on HSKSwap?",
    description: "Live quote, price impact, 10 minute TWAP and APRO oracle checks on HSK mainnet. Returns ALLOW, REDUCE with a safe size, or BLOCK.",
    priceUsd: "0.25",
    example: "/v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=300&maxImpactBps=100",
    decides: true,
  },
  {
    id: "pay-gate",
    title: "Pay gate",
    question: "May I pay this address?",
    description: "Contract or wallet, verified source, transaction history and the operator denylist. Returns ALLOW, HOLD or BLOCK.",
    priceUsd: "0.10",
    example: "/v1/pay-gate?address=0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3",
    decides: true,
  },
  {
    id: "pool-depth",
    title: "Pool depth",
    question: "How deep is this pool?",
    description: "Reserves, liquidity, tick and a live quote for your size on the deepest HSKSwap pool for the pair.",
    priceUsd: "0.05",
    example: "/v1/pool-depth?tokenA=USDT&tokenB=WHSK&amount=2000",
    decides: false,
  },
  {
    id: "price-sanity",
    title: "Price sanity",
    question: "Is this pool price believable?",
    description: "Pool spot price against its 10 minute TWAP and the APRO oracle, with deviation in basis points.",
    priceUsd: "0.05",
    example: "/v1/price-sanity?tokenA=WHSK&tokenB=USDT",
    decides: false,
  },
  {
    id: "token-check",
    title: "Token check",
    question: "What powers does this token contract have?",
    description: "Proxy detection, admin functions found in bytecode, supply and Blockscout verification status.",
    priceUsd: "0.05",
    example: "/v1/token-check?token=0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029",
    decides: false,
  },
  {
    id: "chain-status",
    title: "Chain status",
    question: "Is HSK Chain live right now?",
    description: "Latest block, block age and gas price. The freshness check every other answer depends on.",
    priceUsd: "0.01",
    example: "/v1/chain-status",
    decides: false,
  },
];

export const skuById = (id: string) => SKUS.find(s => s.id === id);
