/**
 * The trading agent's decision loop, as a stream of events. The CLI prints
 * them; the dashboard streams them from POST /v1/demo/agent. Both run the
 * same code, so what judges watch on screen is what the agent does.
 *
 * Loop: discover → (optional pay-gate on the payee) → trade-gate → obey:
 *   BLOCK refuses, REDUCE shrinks once and buys a fresh check, ALLOW takes a
 *   fresh quote and sets a slippage floor before any swap.
 */
import type { LocalAccount } from "viem";

import { chainTip, resolveToken, toHuman, toRaw } from "../hsk/market.js";
import type { Verdict } from "../verdict/envelope.js";
import { Buyer, type Outcome, type PaidAnswer } from "./buyer.js";
import { executeSwap, planSwap } from "./swap.js";

export interface AgentTask {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  maxImpactBps: string;
  slippageBps: number;
  corrupt?: boolean;
  checkPayee?: boolean;
  /** Send the swap. Only the CLI can set this; the web endpoint never does. */
  execute?: boolean;
}

export type AgentEvent =
  | { type: "step"; title: string }
  | { type: "note"; text: string }
  | { type: "answer"; sku: string; verdict: Verdict; reasons: string[]; resultHash: string; requestId: string; blockNumber: number; payment: PaidAnswer["payment"]; receipt: PaidAnswer["receipt"]; data: Record<string, unknown> }
  | { type: "rejected"; stage: string; problems: string[]; claimedVerdict?: Verdict }
  | { type: "swap-plan"; freshQuote: string; minimumOut: string; tokenOut: string; slippageBps: number }
  | { type: "swap"; status: string; tx: string; approveTx?: string }
  | { type: "done"; outcome: "refused" | "dry-run" | "swapped" | "stopped"; summary: string };

export interface AgentOptions {
  seller: string;
  account: LocalAccount;
  maxUsdPerCall: number;
  canSwap: boolean;
  /** Chain tip used for the freshness check. Defaults to HSK mainnet. */
  currentBlock?: () => Promise<number>;
}

export async function runAgent(task: AgentTask, opts: AgentOptions, emit: (e: AgentEvent) => void): Promise<void> {
  const buyer = new Buyer({
    seller: opts.seller,
    account: opts.account,
    maxUsdPerCall: opts.maxUsdPerCall,
    currentBlock: opts.currentBlock ?? (async () => (await chainTip()).number),
    onStep: text => emit({ type: "note", text }),
  });
  const done = (outcome: Extract<AgentEvent, { type: "done" }>["outcome"], summary: string) => emit({ type: "done", outcome, summary });

  /** Emits the outcome. Returns the answer only when it may be acted on. */
  const accept = (sku: string, r: Outcome): PaidAnswer | null => {
    if (!r.ok) {
      emit({ type: "rejected", stage: r.stage, problems: r.problems, claimedVerdict: r.answer?.verdict });
      return null;
    }
    const a = r.answer;
    emit({ type: "answer", sku, verdict: a.verdict, reasons: a.reasons, resultHash: a.proof.resultHash, requestId: r.requestId, blockNumber: a.proof.blockNumber, payment: a.payment, receipt: a.receipt, data: a.data });
    return a;
  };

  emit({ type: "step", title: "Discover the seller" });
  const cat = await buyer.discover();
  emit({ type: "note", text: `${cat.skus.length} checks for sale, paid in ${cat.payment.token.symbol} on ${cat.payment.network} through ${cat.payment.protocol}` });

  if (task.checkPayee) {
    emit({ type: "step", title: "Is the seller's payee safe to pay?" });
    const a = accept("pay-gate", await buyer.ask("pay-gate", { address: cat.payment.payTo }));
    if (!a) return done("refused", "The payee check could not be verified, so the agent did not continue.");
    if (a.verdict !== "ALLOW") return done("refused", `The payee check returned ${a.verdict}.`);
  }

  let amount = task.amountIn;
  for (let round = 0; round < 2; round++) {
    emit({ type: "step", title: `May I swap ${amount} ${task.tokenIn} for ${task.tokenOut} within ${task.maxImpactBps} bps?` });
    const query: Record<string, string> = { tokenIn: task.tokenIn, tokenOut: task.tokenOut, amountIn: amount, maxImpactBps: task.maxImpactBps };
    if (task.corrupt) query.corrupt = "1";
    const a = accept("trade-gate", await buyer.ask("trade-gate", query));
    if (!a) return done("refused", "The answer failed verification. The agent paid, but it will not act on an answer it cannot verify.");

    if (a.verdict === "BLOCK") return done("refused", "Risklayer said BLOCK. No trade.");
    if (a.verdict === "REDUCE") {
      const suggested = a.data.recommendedAmountIn as string | null;
      if (!suggested || round === 1) return done("refused", "Still above the limit after reducing once. No trade.");
      emit({ type: "note", text: `Following the verdict: reducing from ${amount} to ${suggested} and buying a fresh check.` });
      amount = suggested;
      continue;
    }
    if (a.verdict !== "ALLOW") return done("refused", `Unexpected verdict ${a.verdict}. No trade.`);

    emit({ type: "step", title: "Allowed. Fresh quote and slippage floor before sending" });
    const [tokenIn, tokenOut] = await Promise.all([resolveToken(task.tokenIn), resolveToken(task.tokenOut)]);
    const pool = a.data.pool as { feeTier: number };
    const plan = await planSwap(tokenIn.address, tokenOut.address, pool.feeTier, toRaw(amount, tokenIn.decimals), task.slippageBps);
    const fmt = (raw: bigint) => Number(toHuman(raw, tokenOut.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
    emit({ type: "swap-plan", freshQuote: fmt(plan.freshQuote), minimumOut: fmt(plan.amountOutMinimum), tokenOut: tokenOut.symbol, slippageBps: plan.slippageBps });
    if (!task.execute || !opts.canSwap) return done("dry-run", `Would swap ${amount} ${task.tokenIn} on HSKSwap with a minimum of ${fmt(plan.amountOutMinimum)} ${tokenOut.symbol}.`);
    const result = await executeSwap(opts.account, plan);
    emit({ type: "swap", status: result.status, tx: result.swapTx, approveTx: result.approveTx });
    return done("swapped", result.status === "success" ? "Swap landed on HSKSwap." : "Swap reverted on chain.");
  }
}
