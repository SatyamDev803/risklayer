# Risklayer dashboard

A Next.js 16 single page: hero with live verdicts, the check console with the paid agent and the tamper test, How it works, Paid answers, and Connect.

```bash
npm install
cp .env.example .env.local      # RISKLAYER_URL=http://localhost:4021
npx next dev -p 3021
```

For the "Run the paid agent" button, the API must be running with `DEMO_AGENT=1`.

## How it talks to the API

The browser never calls the API directly. `app/api/rl/[...path]/route.ts` is a same-origin proxy with an allowlist:
- `preview/*`
- `v1/activity`
- `v1/demo/agent`
- `catalogue`
- `health`

It streams responses through unbuffered, so agent events arrive live.

## Files

| Path | What |
|---|---|
| `app/page.tsx` | Page composition and toasts |
| `components/overview.tsx` | Hero, plus the live "Right now on HSKSwap" card (three free previews) |
| `components/checkConsole.tsx` | Swap form, mode switch, tamper switch, NDJSON stream reader |
| `components/verdictPanel.tsx` | Answer, Refused and Preview panels: impact meter, evidence, rules, proof |
| `components/agentLog.tsx` | Groups agent events into steps |
| `components/activityFeed.tsx` | Paid answers, polled every 4 s by `lib/useRisklayer.ts` |
| `components/connect.tsx` | MCP, paid and preview commands, catalogue, settlement |
| `components/ui/*` | Card and grouped list, Button, Switch, Segmented control |
| `lib/format.ts` | `cn`, number formatting, verdict colours (`VERDICT_TONE` for fills, `VERDICT_INK` for text) |
| `lib/theme.ts` | System, light and dark theme, saved in `localStorage` as `risklayer.theme` |

The design rules are in the "UI rules" section of `../CONTRIBUTING.md`.
