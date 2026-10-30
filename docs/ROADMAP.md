# Roadmap and open tasks

Deadline: **submit by Nov 1, 18:00 IST** (the hard deadline is 21:30). Demo Day is Nov 4 in Mumbai, in person.

## Done

- [x] trade-gate, pay-gate, pool-depth, price-sanity, token-check and chain-status, on live HSK mainnet data
- [x] Deterministic verdict rules that fail closed, with tests
- [x] Sealed, request-bound answers and buyer-side verification
- [x] HSP merchant side (HMAC, ES256K cart JWT, Cart Mandate, webhooks), built from HashKey's published docs
- [x] HSP-compatible local gateway (simulated, or real with a relayer)
- [x] Trading agent: pays, verifies, obeys, and swaps with a slippage floor
- [x] MCP server with six tools
- [x] `RisklayerReceipts.sol` with Foundry tests
- [x] Dashboard with the paid agent run, tamper test, activity feed and connect page
- [x] CI, a Render blueprint, a key generator and docs

## Lane R: rail

- [ ] Run `npm run keys` and post the onboarding message from [HSP.md](HSP.md) in the HSP Telegram group
- [ ] Ask HashKey for the `pay-mandate` body. Update `src/hsp/mandate.ts` and `payer.ts` if it differs
- [ ] Fund the seller, agent and relayer wallets (see [SETUP.md](SETUP.md#3-fund-the-wallets-hsk-mainnet-chain-177))
- [ ] Deploy and verify `RisklayerReceipts` on mainnet. Put the address in the README and `.env`
- [ ] Run one paid check with a relayer, so a real USDC.e transfer and receipt appear on Blockscout
- [ ] Deploy both services to Render and fill the live URLs in the README
- [ ] Once credentials arrive: switch to `HSP_MODE=hsp` on QA, then production

## Lane P: product

- [ ] Record the 3 minute video, following [DEMO.md](DEMO.md)
- [ ] Build the 8 slide deck: problem, product, agent to agent flow, demo stills, proof, HSK and HSP fit, what's next
- [ ] Run one real swap with `--execute` at a small size and link it in the README
- [ ] Optional: a `whale-flow` SKU using `eth_getLogs` Transfer events
- [ ] Optional: an LLM explanation line under the verdict. It must never change the verdict
- [ ] Optional: an EAS attestation alongside the receipt, through the `0x4200…0021` predeploy

## Submission checklist (DoraHacks)

- [ ] Public repo, with README, architecture and honest scope notes
- [ ] Contract address and Blockscout verification link
- [ ] Live URLs: dashboard, `/catalogue`, `/mcp`
- [ ] Video and deck
- [ ] Track: Agent Payments & A2A Settlement. Mention HSKSwap, APRO, Blockscout and HSP
- [ ] Mumbai Demo Day registration

## Known limits

- HashKey has not published the payer-side `pay-mandate` body, so ours is a best guess based on their Go SDK.
- Requests and payments live in memory, so a restart drops unpaid requests.
- The pay-gate denylist is operator-maintained. It is not a sanctions feed.
