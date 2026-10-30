# Demo (3 minutes)

Before going on stage:
- the server is running with `RECEIPTS_ADDRESS` set
- the agent wallet holds USDC.e and USDT
- the terminal font is large

| Time | Do | Say |
|---|---|---|
| 0:00 | Dashboard home | "Agents are about to move money on HSK. Risklayer is the check they run first, and they pay for it agent to agent through HSP." |
| 0:20 | `/catalogue`, then the `claude mcp add` line | Six checks, free preview, paid full answer. It also works inside Claude. |
| 0:40 | Dashboard: 60000 USDT into WHSK, **Run the paid agent** (or `npm run agent -- --amount 60000`) | 402 with HSP Cart Mandate. The agent checks the signed terms and signs an EIP-3009 Payment Mandate. Payment settles and the verdict is **REDUCE**: 1206 bps impact, safe size about 4,300. |
| 1:20 | Same run continues | The agent reduces, buys a fresh check, gets **ALLOW**, takes a fresh quote, and sets the slippage limit. With `--execute` the swap lands. Open Blockscout for the payment, receipt and swap. |
| 2:00 | Tick **Tamper test**, run again (or `npm run agent -- --amount 300 --corrupt`) | The seller flips BLOCK or REDUCE to ALLOW after sealing. The agent recomputes the hash, finds a mismatch, and refuses. "It paid, but it does not trust. The receipt on chain shows what the seller committed to." |
| 2:40 | Close | "Risklayer. One paid check before every move on HSK." |

Fallbacks, in order:
- If real HSP is down, use `HSP_MODE=local` with a relayer. The USDC transfer is still real, and the gateway is labelled.
- If there is no funded relayer, use local simulated mode. Every screen says simulated.
- If the network is down, play the recorded video.
