/**
 * CLI for the demo buyer: an autonomous trading agent with a wallet and no
 * accounts anywhere. Before it moves money it buys a Risklayer check, pays
 * for it through HSP, verifies the answer, and obeys the verdict.
 *
 *   npm run agent -- --in USDT --out WHSK --amount 60000
 *   npm run agent -- --in USDT --out WHSK --amount 300 --execute
 *   npm run agent -- --in USDT --out WHSK --amount 300 --corrupt
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { HSK_MAINNET } from "../config.js";
import { runAgent, type AgentEvent } from "./runAgent.js";

const { values: args } = parseArgs({
  options: {
    in: { type: "string", default: "USDT" },
    out: { type: "string", default: "WHSK" },
    amount: { type: "string", default: "60000" },
    "max-impact": { type: "string", default: "100" },
    slippage: { type: "string", default: "50" },
    execute: { type: "boolean", default: false },
    corrupt: { type: "boolean", default: false },
    "check-payee": { type: "boolean", default: false },
  },
});

const EXPLORER = HSK_MAINNET.explorer;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const tint: Record<string, string> = { ALLOW: "\x1b[32m", REDUCE: "\x1b[33m", BLOCK: "\x1b[31m", HOLD: "\x1b[33m", INFO: "\x1b[36m" };
const say = (text: string) => console.log(`    ${text}`);
let n = 0;

function print(e: AgentEvent) {
  switch (e.type) {
    case "step":
      console.log(`\n${bold(`[${n++}] ${e.title}`)}`);
      break;
    case "note":
      say(e.text);
      break;
    case "answer":
      say(`Verified: hash ${e.resultHash.slice(0, 23)}… recomputed and matched, bound to request ${e.requestId.slice(0, 8)}`);
      say(`${tint[e.verdict] ?? ""}${bold(e.verdict)}\x1b[0m`);
      for (const r of e.reasons) say(`  ${r}`);
      if (e.payment.tx) say(`payment tx ${e.payment.chainId === 177 ? EXPLORER : "https://testnet-explorer.hsk.xyz"}/tx/${e.payment.tx}`);
      if (e.payment.simulated) say("payment verified by the local gateway but not broadcast (simulated)");
      if (e.receipt?.tx) say(`receipt ${EXPLORER}/tx/${e.receipt.tx}`);
      else if (e.receipt?.error) say(`receipt not written: ${e.receipt.error}`);
      break;
    case "rejected":
      say(`${tint.BLOCK}Refusing to act. Stopped at ${e.stage}:\x1b[0m`);
      for (const p of e.problems) say(`  - ${p}`);
      if (e.claimedVerdict) say(`The answer claimed ${e.claimedVerdict}.`);
      break;
    case "swap-plan":
      say(`fresh quote ${e.freshQuote} ${e.tokenOut}, minimum accepted ${e.minimumOut} (${e.slippageBps} bps slippage)`);
      break;
    case "swap":
      if (e.approveTx) say(`approve ${EXPLORER}/tx/${e.approveTx}`);
      say(`${e.status === "success" ? "swap landed" : "swap reverted"}: ${EXPLORER}/tx/${e.tx}`);
      break;
    case "done":
      console.log(`\n${bold(e.outcome === "swapped" ? "Done" : e.outcome === "dry-run" ? "Dry run" : "No trade")}`);
      say(e.summary);
      if (e.outcome === "dry-run") say("Add --execute with a funded AGENT_PRIVATE_KEY to send it.");
      break;
  }
}

const key = process.env.AGENT_PRIVATE_KEY?.trim() as Hex | undefined;
const account = privateKeyToAccount(key || generatePrivateKey());
console.log(bold("Risklayer trading agent: check before you move money"));
say(`agent wallet ${account.address}${key ? "" : " (throwaway key, set AGENT_PRIVATE_KEY to pay for real)"}`);

runAgent(
  { tokenIn: args.in!, tokenOut: args.out!, amountIn: args.amount!, maxImpactBps: args["max-impact"]!, slippageBps: Number(args.slippage), corrupt: args.corrupt, checkPayee: args["check-payee"], execute: args.execute },
  { seller: (process.env.SELLER_URL ?? "http://localhost:4021").replace(/\/$/, ""), account, maxUsdPerCall: Number(process.env.AGENT_MAX_USD_PER_CALL ?? 1), canSwap: !!key },
  print,
).catch(e => {
  console.error(`\nagent failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
