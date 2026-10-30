# Risklayer

**The check an AI agent runs before it moves money on HSK Chain. Paid agent-to-agent through HSP, recorded on-chain.**

An agent that can call a DEX router is not the same as an agent that knows whether the swap is safe. Risklayer is a separate seller agent: the trading agent asks it a question, pays for the answer through HSP, verifies the answer, and obeys it.

```
trading agent ── "swap 60,000 USDT for WHSK within 100 bps?" ──▶ Risklayer
              ◀─ 402 + HSP Cart Mandate (signed terms) ──────────
              ── AP2 Payment Mandate (EIP-3009, USDC) ──▶ HSP gateway ──▶ HSK Chain
              ◀─ webhook: payment-included ─────────── (to Risklayer)
              ── same question + request id ─────────────────▶ Risklayer
              ◀─ REDUCE to 4,300 USDT, evidence, sha256 proof, receipt tx
   recompute hash ✓  request id ✓  fresh ✓  → reduce, re-check → ALLOW → swap on HSKSwap
```

Track: **Agent Payments & A2A Settlement (HSP)**. It also uses HSKSwap, APRO oracles, Blockscout and HSK mainnet.

## What it answers

| SKU | Question | Verdicts | Price |
|---|---|---|---|
| `trade-gate` | May I make this swap on HSKSwap? | ALLOW · REDUCE (with safe size) · BLOCK | $0.25 |
| `pay-gate` | May I pay this address? | ALLOW · HOLD · BLOCK | $0.10 |
| `pool-depth` | How deep is this pool? | evidence | $0.05 |
| `price-sanity` | Is this pool price believable (TWAP, APRO)? | evidence | $0.05 |
| `token-check` | What powers does this token contract have? | evidence | $0.05 |
| `chain-status` | Is HSK Chain live right now? | evidence | $0.01 |

All market data is read live from **HSK mainnet (chain 177)**: QuoterV2 and pools on HSKSwap, APRO price feeds, Blockscout. A real run on 31 Oct 2026:

| Question | Verdict | Why |
|---|---|---|
| 60,000 USDT → WHSK, ≤100 bps | **REDUCE** | 1206 bps impact; largest size within limit ≈ 4,300 USDT |
| 500 USDT → WHSK, ≤100 bps | **ALLOW** | 11 bps impact, TWAP 1 bps, APRO 34 bps |
| 900,000 USDT → WHSK | **BLOCK** | 6729 bps impact, above the 1500 bps hard limit |

## How a verdict is made

Deterministic rules over evidence, in `src/verdict/rules.ts`. No LLM decides anything. Missing or stale evidence fails closed:

1. Latest block older than 60 s → BLOCK
2. No live quote → BLOCK
3. Spot more than 200 bps from its 10 minute TWAP → BLOCK (manipulation or fast market)
4. Pool more than 300 bps from APRO oracle → BLOCK (oracle older than 24 h is ignored, not trusted)
5. Price impact above 1500 bps → BLOCK
6. Price impact above your limit → REDUCE, with the largest size within it (binary search on live quotes)
7. Otherwise → ALLOW

Price impact is the move this trade causes. It is not slippage: the agent still sets `amountOutMinimum` from a fresh quote on the swap itself.

## What the proof proves, and what it doesn't

Every answer carries `resultHash = sha256(canonical JSON of version, requestId, sku, query, verdict, reasons, data, sources, generatedAt, blockNumber, chainId)`, using RFC 8785 canonical JSON, the same rules HSP uses for `cart_hash`.

- **It proves** the answer was not changed after the seller produced it, and that it belongs to this request and this question.
- **The buyer also checks** age (≤180 s) and block lag, so a valid but old answer is refused.
- **It does not prove** the underlying data is true. The sources are listed so anyone can re-read them at that block.
- **The receipt** (`RisklayerReceipts.record`) is an on-chain audit record of which answer hash the seller stood behind for which payment. It is not escrow: HSP pays the seller directly.

## Payments: what is real

Two modes, set by `HSP_MODE`:

- **`hsp`** uses HashKey's Merchant API: HMAC-signed requests, ES256K `merchant_authorization` JWT bound to `cart_hash`, signed webhooks. It needs onboarding credentials from HashKey.
- **`local`** uses an **HSP-compatible local gateway** at `/hsp-local`. It speaks the same wire format and labels itself "not HashKey" in every response.
  - With `RELAYER_PRIVATE_KEY` set, it submits the agent's EIP-3009 authorization on chain, and the USDC transfer is real.
  - Without it, the authorization is fully verified but not broadcast. Every record then says `simulated: true`.

HashKey has not published the payer-side `pay-mandate` body. We send the AP2 `PaymentMandate` shape from HashKey's Go SDK, with an x402 v2 `exact` payload in `payment_response.details`. See `docs/HSP.md`.

## Run it

```bash
npm install
cp .env.example .env
npm run keys            # prints fresh seller/agent/relayer keys and writes the merchant PEM
npm run server          # http://localhost:4021  (catalogue, /v1/*, /preview/*, /mcp, /hsp-local)
npm run agent -- --in USDT --out WHSK --amount 60000              # REDUCE, then re-check, then ALLOW
npm run agent -- --in USDT --out WHSK --amount 300 --corrupt      # seller lies, agent refuses
npm run agent -- --in USDT --out WHSK --amount 300 --execute      # real swap (funded AGENT_PRIVATE_KEY)
```

Dashboard (Check, Activity, Connect):

```bash
# API with the dashboard's "Run the paid agent" button enabled (it never sends a swap)
ALLOW_SIMULATED_PAYMENTS=1 DEMO_AGENT=1 npm run server
cd web && npm install && cp .env.example .env.local && npm run dev    # http://localhost:3000
```

Try it from Claude: `claude mcp add --transport http risklayer http://localhost:4021/mcp`

Free preview without paying: `curl 'localhost:4021/preview/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=60000'`

## Contract

`contracts/src/RisklayerReceipts.sol` uses Foundry with no dependencies.

```bash
npm run contracts:test
set -a; source .env; set +a
npm run contracts:deploy     # HSK mainnet, constructor arg = SELLER_ADDRESS
npm run contracts:verify     # Blockscout
```

Deployed address: _to be filled in after deploy_.

## Tests

```bash
npm run typecheck
npm test                                  # unit + in-process end to end (offline)
LIVE=1 npx vitest run src/live.test.ts    # full paid loop on live HSK mainnet data
npm run contracts:test
cd web && npm run typecheck && npm run build
```

## Layout

```
src/server.ts            entrypoint: env, HSP mode, mounts
src/app.ts               402 → payment → verified answer → receipt
src/products/            trade-gate, pay-gate, pool-depth, price-sanity, token-check, chain-status
src/verdict/             rules (pure), envelope + hash, canonical JSON
src/hsk/                 viem client, HSKSwap / APRO reads
src/hsp/                 HMAC, JWT, webhooks, Cart Mandate, AP2 mandate, EIP-3009, local gateway, payer
src/agent/               buyer client, trading agent, swap with slippage protection
src/mcp/server.ts        MCP tools over the same engine
contracts/               RisklayerReceipts + tests
web/                     Next.js dashboard: Check (free preview or watch the paid agent), Activity, Connect
```

## Scope notes

- The `pay-gate` denylist is operator-maintained. It is not a sanctions feed, and an address missing from it is not proven safe.
- `token-check` reports capabilities found in bytecode, such as mint, pause, blacklist and upgrade. A capability is not evidence of bad intent.
- Risklayer cannot force any agent to obey it. The demo agent enforces the verdict in its own code, and that enforcement is the point of the demo.
