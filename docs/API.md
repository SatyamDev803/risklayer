# API reference

Base URL: `http://localhost:4021` locally. Every response is JSON and sends `Cache-Control: no-store`.

## Free

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ ok, hspMode, payments, network, receipts }` |
| GET | `/catalogue` | SKUs and prices, payment terms (payee, token, chain, `payMandateUrl`), merchant public key, receipts contract |
| GET | `/preview/:sku?...` | `{ preview: true, sku, verdict, reasons, blockNumber, note }`. No evidence, proof or receipt |
| GET | `/v1/activity?limit=50` | `{ entries: ActivityEntry[] }`, newest first. `requestId` here is a short hash, never the real id |
| GET | `/v1/requests/:id` | Payment status of a request. It never returns the answer |
| POST | `/mcp` | MCP streamable HTTP, stateless |

## Paid: `GET /v1/:sku`

| SKU | Query | Price |
|---|---|---|
| `trade-gate` | `tokenIn`, `tokenOut`, `amountIn`, `maxImpactBps` (1 to 5000, default 100) | $0.25 |
| `pay-gate` | `address` | $0.10 |
| `pool-depth` | `tokenA`, `tokenB`, `amount` (optional) | $0.05 |
| `price-sanity` | `tokenA`, `tokenB` | $0.05 |
| `token-check` | `token` | $0.05 |
| `chain-status` | none | $0.01 |

Tokens can be given as `WHSK`, `USDT`, `USDC`, `WETH`, `WBTC` or any 0x address on HSK Chain.

### Step 1: ask without the header

```
GET /v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=300
→ 402 Payment Required
X-Risklayer-Request: 9a1c…
{
  "error": "payment_required",
  "requestId": "9a1c…",
  "sku": "trade-gate",
  "query": { "amountIn": "300", "tokenIn": "USDT", "tokenOut": "WHSK" },
  "priceUsd": "0.25",
  "hsp": {
    "mode": "local",
    "label": "HSP-compatible local gateway (not HashKey)",
    "paymentRequestId": "RL-PR-9a1c…",
    "cartMandateId": "RL-CART-9a1c…",
    "paymentUrl": "…/flow/<flowId>",
    "payMandateUrl": "…/api/v1/payment/pay-mandate",
    "cartMandate": { "contents": { … }, "merchant_authorization": "<ES256K JWT>" }
  },
  "retry": { "header": "X-Risklayer-Request", "value": "9a1c…" }
}
```

A malformed query returns **400** before any order is created. If the payment gateway is down, the response is **503** and nothing is charged.

### Step 2: pay

Submit an AP2 Payment Mandate to `hsp.payMandateUrl`. See [HSP.md](HSP.md) for the body, or use `buildMandate` and `submitMandate` in `src/hsp/payer.ts`.

### Step 3: ask again with the header

```
GET /v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=300
X-Risklayer-Request: 9a1c…
```

| Status | Meaning |
|---|---|
| 200 | The sealed answer, plus `payment` and `receipt` blocks |
| 402 | Not paid yet. The body includes `payment.status`. Poll every 1 to 2 s |
| 404 | Unknown request id |
| 409 | This request id was paid for a different SKU or query |
| 502 | Paid, but the data source failed. Retry with the same id; you are not charged again |

The answer is computed once per payment, and repeats return the same body. The envelope format is described in [ARCHITECTURE.md](ARCHITECTURE.md#the-answer-envelope).

### Demo switch

Add `corrupt=1` to the query, on both the first and the second request. The seller then changes the verdict to ALLOW after sealing it. A buyer that verifies will refuse the answer. The switch is excluded from the request binding.

## Webhook: `POST /v1/hsp/webhook`

This is HSP's payment notification. It requires `X-Signature: t=<unix>,v1=<hex HMAC-SHA256(app_secret, t + "." + rawBody)>` within ±300 s. It returns `{ "code": 0 }`, or 401 if the signature is bad. The handler is idempotent and never moves a payment backwards.

## Demo agent: `POST /v1/demo/agent`

Enabled only when `DEMO_AGENT=1`. It runs the trading agent against this server and streams **NDJSON** events.

Request body: `{ tokenIn, tokenOut, amountIn, maxImpactBps, corrupt?, checkPayee? }`.

Event types:
- `step`
- `note`
- `answer`
- `rejected`
- `swap-plan`
- `swap`
- `done` (with `outcome`: `refused`, `dry-run`, `swapped` or `stopped`)

It never sends a swap. It runs one agent at a time and at most `DEMO_AGENT_MAX_RUNS_PER_HOUR` per hour (default 30); beyond that it returns 429. When `DEMO_AGENT_TOKEN` is set, requests need a matching `X-Demo-Token` header (the dashboard proxy adds it on the server side), or they get 401.

## MCP tools

The tools are `trade_gate`, `pay_gate`, `pool_depth`, `price_sanity`, `token_check` and `chain_status`. Each returns the free preview as text, plus the paid URL for the full answer.

```bash
claude mcp add --transport http risklayer http://localhost:4021/mcp
```
