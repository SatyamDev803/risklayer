# Architecture

Risklayer has four parts: a seller API, a buyer agent, a receipt contract and a dashboard.
They share one engine: `runSku` in `src/products/runSku.ts`.

```
                    ┌──────────────────────── src/server.ts (entrypoint) ────────────────────────┐
 buyer agent  ──▶   │ src/app.ts  /v1/:sku  /preview/:sku  /v1/hsp/webhook  /v1/demo/agent       │
 (src/agent)        │   │                │                                                       │
                    │   ▼                ▼                                                       │
 MCP clients  ──▶   │ src/mcp ──▶ src/products/runSku.ts ──▶ products/* ──▶ src/hsk (viem, 177)   │
                    │                    │                                                       │
                    │                    ▼                                                       │
                    │          src/verdict (rules, envelope, canonical JSON)                     │
                    │                                                                            │
                    │ src/hsp/localGateway.ts at /hsp-local (only when HSP_MODE=local)           │
                    └────────────────────────────────────────────────────────────────────────────┘
 dashboard (web/) ──▶ /api/rl/* proxy ──▶ the API above
 receipts ──▶ contracts/src/RisklayerReceipts.sol on HSK mainnet
```

## Module map

| Path | What it owns | Touch it when |
|---|---|---|
| `src/config.ts` | Chain ids, RPCs, token and HSKSwap addresses, payment tokens, verdict policy | An address, threshold or network changes |
| `src/hsk/client.ts` | viem client for chain 177, chain definitions, ABIs | You need a new contract call |
| `src/hsk/market.ts` | Read-only evidence: tip, pools, quotes, TWAP, APRO | A product needs new on-chain data |
| `src/verdict/rules.ts` | Pure verdict rules (`tradeGate`, `payGate`) | The decision logic changes |
| `src/verdict/envelope.ts` | Answer schema, `seal`, buyer-side `verifyEnvelope` | The proof format changes (coordinate with both lanes) |
| `src/verdict/canonical.ts` | RFC 8785 canonical JSON and SHA-256 | Never, unless HSP changes its rules |
| `src/products/*` | One file per SKU family, plus `runSku` | Adding or changing a check |
| `src/catalogue.ts` | SKU ids, titles, prices, examples | Adding a SKU or changing a price |
| `src/hsp/signing.ts` | HMAC, ES256K merchant JWT, webhook signatures | HashKey changes its auth |
| `src/hsp/merchant.ts` | Cart Mandate builder, merchant API client, paid states | HSP order format changes |
| `src/hsp/eip3009.ts` | USDC `TransferWithAuthorization` signing and recovery | Token or domain changes |
| `src/hsp/mandate.ts` | AP2 Payment Mandate shape | HashKey confirms the `pay-mandate` body |
| `src/hsp/payer.ts` | Buyer side: check terms, sign, submit | Same as above |
| `src/hsp/localGateway.ts` | HSP-compatible gateway for local and fallback use | Mirroring HSP behaviour |
| `src/app.ts` | HTTP surface: 402 flow, webhook, preview, demo agent | Adding a route |
| `src/receipts.ts` | Writes `RisklayerReceipts.record` | Contract interface changes |
| `src/agent/buyer.ts` | Ask, pay, poll, verify | Buyer behaviour changes |
| `src/agent/runAgent.ts` | The trading agent's decision loop as events | Agent policy changes |
| `src/agent/swap.ts` | Fresh quote, slippage floor, HSKSwap swap | Swap execution changes |
| `src/mcp/server.ts` | MCP tools (free preview) | Adding a tool |
| `web/` | Next.js dashboard | UI work |

## One paid question, end to end

1. **Ask.** The buyer calls `GET /v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=60000`.
2. **Validate.** `validateQuery` runs first. A malformed question gets a 400 and costs nothing.
3. **Challenge.** The seller builds a Cart Mandate. Its ids are `RL-CART-<requestId>` and `RL-PR-<requestId>`, and it is priced in USD and paid in USDC. The seller signs it with the ES256K merchant JWT and creates the order at the gateway. It then returns **402** with the request id in `X-Risklayer-Request`.
4. **Check terms.** `checkChallenge` confirms:
   - the JWT was signed by the merchant key published in `/catalogue`
   - `cart_hash` matches
   - the payee, token and chain are right
   - the price is within the spend limit
5. **Pay.** The buyer signs an EIP-3009 authorization for exactly that amount. Its nonce is `keccak256("risklayer:" + payment_request_id)`. The buyer wraps it in an AP2 Payment Mandate and posts it to `pay-mandate`.
6. **Settle.** The gateway verifies the authorization and submits it on chain if a relayer is configured. It then sends a signed webhook to `/v1/hsp/webhook`. The webhook handler is idempotent and never moves a payment backwards.
7. **Answer.** The buyer repeats the request with the header. The seller checks the request id is bound to the same SKU and query, and that the payment is in a paid state. It then runs the SKU once, seals the envelope, writes the receipt and returns 200. Repeats return the same answer.
8. **Verify and obey.** The buyer runs `verifyEnvelope`:
   - the hash matches
   - the request id, SKU and query match the question asked
   - the answer is at most 180 s old and at most 120 blocks behind
   - sources are present

   Then `runAgent` acts on the verdict: BLOCK refuses, REDUCE shrinks the size once and re-asks, ALLOW takes a fresh quote and sets `amountOutMinimum`.

## The answer envelope

```ts
{
  version: "risklayer/1",
  requestId, sku, query,          // binding: which question this answers
  verdict: "ALLOW" | "REDUCE" | "BLOCK" | "HOLD" | "INFO",
  reasons: string[],
  data: { ... },                  // SKU-specific evidence
  sources: [{ type, ref, blockNumber?, observedAt?, note? }],
  proof: { resultHash: "sha256:<hex>", generatedAt, blockNumber, chainId, hashedFields },
  payment: { ... }, receipt: { ... } | null   // added by app.ts, not hashed
}
```

`resultHash` is computed as follows:

```
resultHash = sha256(canonicalJSON({ version, requestId, sku, query, verdict, reasons, data, sources, generatedAt, blockNumber, chainId }))
```

Rules for changing it:
- **No `bigint` in `data`.** Convert values to decimal strings first; `canonicalize` throws on them.
- **No `NaN` or `Infinity`.**
- **`corrupt` stays out of the hash.** It is a demo switch, so `boundQuery` strips it.

## Verdict rules (`src/verdict/rules.ts`)

The rules run in this order and fail closed. Defaults live in `POLICY` in `config.ts`, and each can be overridden with an env var.

| # | Check | Default | Result if it fails |
|---|---|---|---|
| 1 | Latest block age | ≤ 60 s | BLOCK |
| 2 | Live quote exists | n/a | BLOCK |
| 3 | Spot vs 10 min TWAP | ≤ 200 bps | BLOCK (skipped if TWAP unavailable) |
| 4 | Pool vs APRO oracle | ≤ 300 bps, oracle ≤ 24 h old | BLOCK (skipped if no feed or stale) |
| 5 | Price impact vs hard limit | ≤ 1500 bps | BLOCK |
| 6 | Price impact vs buyer limit | `maxImpactBps` (default 100) | REDUCE with largest size within limit |
| 7 | All passed | n/a | ALLOW |

Price impact is measured against the pool mid price after the fee: `impact = 1 - quotedOut / (amountIn × spot × (1 - fee))`. The safe size comes from a binary search on live QuoterV2 quotes, at most 12 calls, rounded down to two significant figures.

## Adding a SKU

1. Write the product in `src/products/`. Return a `ProductResult`: `{ verdict, reasons, data, sources, blockNumber }`. Keep the decision in a pure function in `src/verdict/rules.ts` if it decides anything.
2. Add a parser that throws on bad input. Wire it into `validateQuery` and `computeSku` in `runSku.ts`.
3. Add it to `SKUS` in `src/catalogue.ts` with a price and an example.
4. Add an MCP tool in `src/mcp/server.ts`.
5. Add rule tests in `src/verdict/rules.test.ts`. Add the SKU to the live test list in `src/live.test.ts`.

## Payments: modes and states

- `HSP_MODE=hsp` talks to HashKey's Merchant API. `HSP_MODE=local` mounts `src/hsp/localGateway.ts` at `/hsp-local`.
- Fulfilment waits for `payment-included`, `payment-safe` or `payment-finalized`. In local mode with `ALLOW_SIMULATED_PAYMENTS=1`, it also accepts `payment-verified` with `simulated: true`. Every such answer carries the flag, and no receipt is written for it.
- The request id is the buyer's key to its answer. It is returned only in the 402, and the public activity feed shows a short hash of it.
- Details and the open questions for HashKey are in [HSP.md](HSP.md).

## State and persistence

- **Requests and payments** are held in memory in `createApp`. A restart drops unpaid requests, which is fine because the buyer just asks again. Answers already delivered are on the activity log and, when receipts are on, on chain.
- **The activity log** is append-only JSONL at `ACTIVITY_LOG`, defaulting to `./activity.jsonl`.
- **The local gateway** keeps its orders in memory.
