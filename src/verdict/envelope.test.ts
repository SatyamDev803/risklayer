import { describe, expect, it } from "vitest";

import { canonicalize } from "./canonical.js";
import { ENVELOPE_VERSION, seal, verifyEnvelope, type Envelope } from "./envelope.js";

const base = () =>
  seal({
    version: ENVELOPE_VERSION,
    requestId: "req-1",
    sku: "trade-gate",
    query: { amountIn: "300", tokenIn: "USDT", tokenOut: "WHSK" },
    verdict: "BLOCK",
    reasons: ["too big"],
    data: { priceImpactBps: 1206, nested: { b: 2, a: 1 } },
    sources: [{ type: "hskswap-pool", ref: "0xpool", blockNumber: 100 }],
    generatedAt: new Date().toISOString(),
    blockNumber: 100,
    chainId: 177,
  });

const expectFor = (e: Envelope) => ({ requestId: e.requestId, sku: e.sku, query: { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "300" } });

describe("canonicalize", () => {
  it("sorts keys recursively and keeps array order", () => {
    expect(canonicalize({ b: 2, a: 1, nested: { z: "last", m: "middle" }, list: [3, 1] })).toBe('{"a":1,"b":2,"list":[3,1],"nested":{"m":"middle","z":"last"}}');
  });
  it("matches the HSP cart_hash example", () => {
    expect(canonicalize({ merchant_name: "My Store", id: "cart-123", cart_expiry: "2024-03-01T12:00:00Z" })).toBe('{"cart_expiry":"2024-03-01T12:00:00Z","id":"cart-123","merchant_name":"My Store"}');
  });
  it("refuses values it cannot encode deterministically", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow();
    expect(() => canonicalize({ n: 1n })).toThrow();
  });
});

describe("verifyEnvelope", () => {
  it("accepts an untouched answer", () => {
    const e = base();
    expect(verifyEnvelope(e, expectFor(e))).toEqual([]);
  });

  it("rejects a verdict changed after sealing", () => {
    const e = base();
    e.verdict = "ALLOW";
    expect(verifyEnvelope(e, expectFor(e)).join()).toMatch(/hash mismatch/);
  });

  it("rejects a data change after sealing", () => {
    const e = base();
    (e.data as { priceImpactBps: number }).priceImpactBps = 10;
    expect(verifyEnvelope(e, expectFor(e)).join()).toMatch(/hash mismatch/);
  });

  it("rejects a valid answer for a different request", () => {
    const e = base();
    expect(verifyEnvelope(e, { ...expectFor(e), requestId: "req-2" }).join()).toMatch(/expected req-2/);
  });

  it("rejects a valid answer to a different question", () => {
    const e = base();
    expect(verifyEnvelope(e, { ...expectFor(e), query: { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000" } }).join()).toMatch(/does not match/);
  });

  it("rejects a stale answer even when its hash is valid", () => {
    const e = base();
    expect(verifyEnvelope(e, { ...expectFor(e), now: Date.now() + 10 * 60_000 }).join()).toMatch(/stale/);
  });

  it("rejects evidence far behind the chain tip", () => {
    const e = base();
    expect(verifyEnvelope(e, { ...expectFor(e), currentBlock: 1000 }).join()).toMatch(/blocks behind/);
  });
});
