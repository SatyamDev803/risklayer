# Working on Risklayer

Start here. Then read [docs/SETUP.md](docs/SETUP.md) to run it and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to find your way around.

## Lanes

Two people can work without blocking each other. Each lane owns its files.

| Lane | Owns | Main files |
|---|---|---|
| **R: rail** (payments, chain, deploy) | HSP integration, local gateway, receipts contract, wallets, Render | `src/hsp/`, `src/receipts.ts`, `contracts/`, `render.yaml`, `src/server.ts` |
| **P: product** (checks, agent, UI) | Verdict rules, SKUs, buyer agent, MCP, dashboard, pitch | `src/verdict/`, `src/products/`, `src/agent/`, `src/mcp/`, `web/`, `docs/DEMO.md` |

These are shared contracts between the lanes. Change them only together:
- `src/verdict/envelope.ts`: the answer schema and the hash inputs
- the 402 challenge body in `src/app.ts`
- `RECEIPTS_ABI` in `src/receipts.ts` and the contract's `record` signature
- `PaymentChallenge` in `src/hsp/payer.ts`

The open tasks for each lane are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Branches and pull requests

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- Open a PR and ask the other lane to review if you touched a shared contract.
- Merge with a **merge commit** (`gh pr merge --merge`). Never squash or rebase.

## Commits

- One logical change per commit.
- One line, conventional, lowercase: `feat: add whale-flow check`, `fix: round safe size down`, `docs: add render steps`.
- No body, no trailers.

## Before every push

Run the full gate once, in the foreground:

```bash
npm run typecheck && npm test && npm run contracts:test && (cd web && npm run typecheck && npm run build)
```

CI runs the same steps. A red CI is a failed delivery.

## Code rules

- **Filenames:**
  - TypeScript and TSX filenames are camelCase: `tradeGate.ts`, `checkConsole.tsx`.
  - Next.js route files keep their required names (`page.tsx`, `route.ts`).
  - Solidity contracts are PascalCase.
- **Verdicts:** decided by the pure functions in `src/verdict/rules.ts`. Never let an LLM decide one. A model may only explain one.
- **Fail closed:** missing or stale evidence must never produce ALLOW.
- **Answers:** no `bigint` in answer `data`. Convert to a decimal string.
- **Addresses:** every address goes in `src/config.ts`, read from the chain or official docs. Never mix testnet and mainnet addresses.
- **Secrets:** never commit `.env`, `.env.keys` or `*.pem`.
- **Comments:** match the surrounding density. A short block at the top of each module says what it owns. Inline comments explain only what is not obvious.

## UI rules (web/)

The dashboard follows Apple's design language, using the same system as Meridian.

- **Surfaces:** the grouped canvas `--canvas`, white `rounded-[22px]` cards with `shadow-card`, and inset grouped lists (`Group` in `components/ui/card.tsx`).
- **Type:** the system font (SF Pro, with an Inter fallback) and tight display tracking (`tracking-[-0.045em]` on big numbers). Nothing under 11px.
- **Colour:** Apple system colours only. Bright tones (`--green`, `--orange`, `--red`) are for fills and glyphs. Text uses the accessible `--*-ink` variants through `VERDICT_INK`.
- **Motion:** springs from `motion/react`, and `active:scale-[0.97]` on everything you can press. Hover effects only where hover exists. Reduced motion is honoured globally.
- **Copy:** plain words and no jargon. **No em or en dashes in any text a user sees.** Rewrite the sentence by hand instead.
- **Layout and touch:** tap targets of at least 40px. Every screen works at 375px and on desktop.
- **New screens:** show a mockup before building one.
- **Reviews:** review UI with a Before / After / Why table.

## Honesty rules (these protect the pitch)

- Never present local gateway payments as HashKey's. The label "HSP-compatible local gateway (not HashKey)" stays on every surface.
- Simulated payments always show `simulated`.
- Say what the hash and the receipt prove, and what they do not. See the README.
