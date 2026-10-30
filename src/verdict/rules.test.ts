import { describe, expect, it } from "vitest";

import { payGate, tradeGate, type TradeEvidence } from "./rules.js";

const evidence = (over: Partial<TradeEvidence> = {}): TradeEvidence => ({
  blockAgeSec: 2,
  quoteAvailable: true,
  impactBps: 11,
  maxImpactBps: 100,
  twapDeviationBps: 1,
  oracleDeviationBps: 34,
  oracleAgeSec: 3600,
  recommendedAmountIn: null,
  amountIn: "500",
  ...over,
});

describe("tradeGate", () => {
  it("allows a trade inside every limit", () => {
    expect(tradeGate(evidence()).verdict).toBe("ALLOW");
  });

  it("reduces when impact is over the buyer's limit but under the hard limit", () => {
    const r = tradeGate(evidence({ impactBps: 1206, recommendedAmountIn: "4300", amountIn: "60000" }));
    expect(r.verdict).toBe("REDUCE");
    expect(r.reasons.join(" ")).toContain("4300");
  });

  it("blocks above the hard impact limit", () => {
    expect(tradeGate(evidence({ impactBps: 6729, recommendedAmountIn: "4300" })).verdict).toBe("BLOCK");
  });

  it("blocks when no smaller size fits", () => {
    expect(tradeGate(evidence({ impactBps: 400, recommendedAmountIn: null })).verdict).toBe("BLOCK");
  });

  it("fails closed without a quote", () => {
    expect(tradeGate(evidence({ quoteAvailable: false, impactBps: null })).verdict).toBe("BLOCK");
  });

  it("fails closed on a stale chain", () => {
    expect(tradeGate(evidence({ blockAgeSec: 600 })).verdict).toBe("BLOCK");
  });

  it("blocks when spot runs away from its TWAP", () => {
    expect(tradeGate(evidence({ twapDeviationBps: 450 })).verdict).toBe("BLOCK");
  });

  it("blocks when the pool disagrees with the oracle", () => {
    expect(tradeGate(evidence({ oracleDeviationBps: 900 })).verdict).toBe("BLOCK");
  });

  it("ignores a stale oracle instead of trusting it", () => {
    const r = tradeGate(evidence({ oracleDeviationBps: 900, oracleAgeSec: 10 * 86_400 }));
    expect(r.verdict).toBe("ALLOW");
    expect(r.checks.find(c => c.name === "pool vs APRO oracle")?.pass).toBeNull();
  });

  it("is deterministic", () => {
    const e = evidence({ impactBps: 1206, recommendedAmountIn: "4300" });
    expect(tradeGate(e)).toEqual(tradeGate(e));
  });
});

describe("payGate", () => {
  const base = { denylisted: false, isContract: false, verifiedSource: null, txCount: 12, firstSeenAgeDays: null };
  it("allows an active wallet", () => expect(payGate(base).verdict).toBe("ALLOW"));
  it("blocks a denylisted address", () => expect(payGate({ ...base, denylisted: true }).verdict).toBe("BLOCK"));
  it("holds a brand new wallet", () => expect(payGate({ ...base, txCount: 0 }).verdict).toBe("HOLD"));
  it("holds an unverified contract", () => expect(payGate({ ...base, isContract: true, verifiedSource: false }).verdict).toBe("HOLD"));
  it("holds when history is unknown", () => expect(payGate({ ...base, txCount: null }).verdict).toBe("HOLD"));
});
