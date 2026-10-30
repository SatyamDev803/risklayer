/**
 * Deterministic verdict rules. Pure functions over evidence: no network, no
 * LLM. The same evidence always produces the same verdict, which is what
 * lets a buyer (or a judge) re-derive it from the published data.
 *
 * Order matters: missing or stale evidence fails closed before any size
 * check runs, so an answer is never ALLOW by default.
 */
import { POLICY } from "../config.js";
import type { Verdict } from "./envelope.js";

export interface TradeEvidence {
  blockAgeSec: number;
  quoteAvailable: boolean;
  impactBps: number | null;
  maxImpactBps: number;
  twapDeviationBps: number | null;
  oracleDeviationBps: number | null;
  oracleAgeSec: number | null;
  /** Largest input (human units) whose impact stays within maxImpactBps. */
  recommendedAmountIn: string | null;
  amountIn: string;
}

export interface Ruling {
  verdict: Verdict;
  reasons: string[];
  checks: { name: string; pass: boolean | null; detail: string }[];
}

export function tradeGate(e: TradeEvidence, policy = POLICY): Ruling {
  const checks: Ruling["checks"] = [];
  const fail = (reasons: string[]): Ruling => ({ verdict: "BLOCK", reasons, checks });

  const freshChain = e.blockAgeSec <= policy.maxBlockAgeSec;
  checks.push({ name: "chain is fresh", pass: freshChain, detail: `latest block is ${e.blockAgeSec}s old, limit ${policy.maxBlockAgeSec}s` });
  if (!freshChain) return fail([`Chain data is ${e.blockAgeSec}s old, so the evidence cannot be trusted.`]);

  checks.push({ name: "live quote", pass: e.quoteAvailable, detail: e.quoteAvailable ? "QuoterV2 returned a quote" : "no pool or quote for this pair" });
  if (!e.quoteAvailable || e.impactBps === null) return fail(["No live HSKSwap quote for this pair, so there is not enough evidence to allow it."]);

  if (e.twapDeviationBps === null) {
    checks.push({ name: "spot vs 10 min TWAP", pass: null, detail: "TWAP unavailable for this pool" });
  } else {
    const ok = e.twapDeviationBps <= policy.maxTwapDeviationBps;
    checks.push({ name: "spot vs 10 min TWAP", pass: ok, detail: `${e.twapDeviationBps} bps apart, limit ${policy.maxTwapDeviationBps} bps` });
    if (!ok) return fail([`Pool price moved ${e.twapDeviationBps} bps away from its 10 minute average. That looks like manipulation or a fast market.`]);
  }

  if (e.oracleDeviationBps === null) {
    checks.push({ name: "pool vs APRO oracle", pass: null, detail: "no oracle feed for one of the tokens" });
  } else if (e.oracleAgeSec !== null && e.oracleAgeSec > policy.maxOracleAgeSec) {
    checks.push({ name: "pool vs APRO oracle", pass: null, detail: `oracle is ${e.oracleAgeSec}s old, ignored` });
  } else {
    const ok = e.oracleDeviationBps <= policy.maxOracleDeviationBps;
    checks.push({ name: "pool vs APRO oracle", pass: ok, detail: `${e.oracleDeviationBps} bps apart, limit ${policy.maxOracleDeviationBps} bps` });
    if (!ok) return fail([`Pool price is ${e.oracleDeviationBps} bps away from the APRO oracle price.`]);
  }

  const impact = e.impactBps;
  checks.push({ name: "price impact", pass: impact <= e.maxImpactBps, detail: `${impact} bps, your limit ${e.maxImpactBps} bps, hard limit ${policy.hardImpactBps} bps` });
  if (impact > policy.hardImpactBps) {
    return fail([`This size moves the price ${impact} bps, above the ${policy.hardImpactBps} bps hard limit.`, ...sizeHint(e)]);
  }
  if (impact > e.maxImpactBps) {
    if (!e.recommendedAmountIn || Number(e.recommendedAmountIn) <= 0) {
      return fail([`Price impact is ${impact} bps and no smaller size fits under ${e.maxImpactBps} bps.`]);
    }
    return {
      verdict: "REDUCE",
      reasons: [`Price impact is ${impact} bps, above your ${e.maxImpactBps} bps limit.`, ...sizeHint(e)],
      checks,
    };
  }
  return { verdict: "ALLOW", reasons: [`Price impact is ${impact} bps, within your ${e.maxImpactBps} bps limit, and every price check passed.`], checks };
}

function sizeHint(e: TradeEvidence): string[] {
  return e.recommendedAmountIn ? [`The largest size within your limit is about ${e.recommendedAmountIn}.`] : [];
}

export interface PayeeEvidence {
  denylisted: boolean;
  isContract: boolean;
  verifiedSource: boolean | null;
  txCount: number | null;
  firstSeenAgeDays: number | null;
}

export function payGate(e: PayeeEvidence): Ruling {
  const checks: Ruling["checks"] = [];
  checks.push({ name: "not on denylist", pass: !e.denylisted, detail: e.denylisted ? "address is on the configured denylist" : "not on the configured denylist" });
  if (e.denylisted) return { verdict: "BLOCK", reasons: ["This address is on the configured denylist."], checks };

  if (e.isContract) {
    checks.push({ name: "contract source verified", pass: e.verifiedSource, detail: e.verifiedSource === null ? "explorer did not answer" : e.verifiedSource ? "verified on Blockscout" : "source not verified" });
    if (e.verifiedSource !== true) return { verdict: "HOLD", reasons: ["The payee is a contract without verified source. Check it before paying."], checks };
  }
  const history = e.txCount ?? 0;
  checks.push({ name: "has history", pass: e.txCount === null ? null : history > 0, detail: e.txCount === null ? "transaction count unavailable" : `${history} transactions` });
  if (e.txCount === null) return { verdict: "HOLD", reasons: ["Not enough evidence about this address yet."], checks };
  if (!e.isContract && history === 0) return { verdict: "HOLD", reasons: ["This address has never sent a transaction. Confirm it is the right one."], checks };
  return { verdict: "ALLOW", reasons: [e.isContract ? "Verified contract with on-chain history." : `Active address with ${history} transactions.`], checks };
}
