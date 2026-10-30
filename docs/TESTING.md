# Testing

| Layer | File | Runs | Command |
|---|---|---|---|
| Canonical JSON, envelope, buyer verification | `src/verdict/envelope.test.ts` | offline | `npx vitest run src/verdict/envelope.test.ts` |
| Verdict rules | `src/verdict/rules.test.ts` | offline | `npx vitest run src/verdict/rules.test.ts` |
| HMAC, JWT, webhooks, EIP-3009 | `src/hsp/signing.test.ts` | offline | `npx vitest run src/hsp/signing.test.ts` |
| Full paid loop, MCP, demo stream (stubbed market data) | `src/app.test.ts` | offline | `npx vitest run src/app.test.ts` |
| Full paid loop on live HSK mainnet data | `src/live.test.ts` | network | `LIVE=1 npx vitest run src/live.test.ts` |
| Receipt contract | `contracts/test/RisklayerReceipts.t.sol` | offline | `npm run contracts:test` |
| Dashboard types and build | `web/` | offline | `cd web && npm run typecheck && npm run build` |

While you work, run the one test file for the area you changed. Run everything only before pushing:

```bash
npm run typecheck && npm test && npm run contracts:test && (cd web && npm run typecheck && npm run build)
```

That is exactly what CI runs (`.github/workflows/ci.yml`). Push only when it is green.

## What the tests guarantee

- A malformed question never creates an order.
- No answer is released before a paid state.
- A changed verdict, changed data, wrong request id, wrong question, stale answer, or evidence too far behind the tip all fail verification.
- A request id cannot be reused for another question. A paid answer is computed exactly once.
- A buyer refuses to sign terms that pay the wrong address, use the wrong token, chain or key, or go over budget.
- Webhooks without a valid signature are rejected. Replays change nothing.
- Every verdict rule fails closed, and a stale oracle is ignored, not trusted.
- Contract: only the seller records, each payment is recorded once, and empty hashes and unknown verdicts revert.

## Manual demo check

1. Run `ALLOW_SIMULATED_PAYMENTS=1 DEMO_AGENT=1 npm run server`, then `cd web && npx next dev -p 3021`.
2. On the dashboard, run the paid agent at 60000 USDT into WHSK. Expect REDUCE, then ALLOW, then "Would swap…".
3. Turn on Tamper test and run again. Expect Refused, with a hash mismatch.
4. Check that both runs appear under Paid answers.
