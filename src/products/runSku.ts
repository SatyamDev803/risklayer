/**
 * Shared SKU execution: one SKU id + query in, sealed envelope out. Used by
 * the paid REST handlers, the free preview and the MCP tools, so every
 * surface runs the same engine.
 */
import { HSK_MAINNET } from "../config.js";
import { ENVELOPE_VERSION, seal, type Envelope } from "../verdict/envelope.js";
import { canonicalize } from "../verdict/canonical.js";
import { parseAddressQuery, payGate, tokenCheck } from "./addressChecks.js";
import { chainStatus, parsePairQuery, poolDepth, priceSanity } from "./marketChecks.js";
import { parseTradeGateQuery, tradeGate } from "./tradeGate.js";
import type { ProductResult } from "./types.js";

/** Throws on a malformed query. Runs before any payment is requested, so a
 * bad request never costs the buyer money. */
export function validateQuery(sku: string, q: URLSearchParams): void {
  switch (sku) {
    case "trade-gate": parseTradeGateQuery(q); return;
    case "pool-depth":
    case "price-sanity": parsePairQuery(q); return;
    case "token-check": parseAddressQuery(q, "token"); return;
    case "pay-gate": parseAddressQuery(q, "address"); return;
    case "chain-status": return;
    default: throw new Error(`unknown sku '${sku}'`);
  }
}

export async function computeSku(sku: string, q: URLSearchParams): Promise<ProductResult> {
  switch (sku) {
    case "trade-gate": return tradeGate(parseTradeGateQuery(q));
    case "pool-depth": return poolDepth(parsePairQuery(q));
    case "price-sanity": return priceSanity(parsePairQuery(q));
    case "token-check": return tokenCheck(parseAddressQuery(q, "token"));
    case "pay-gate": return payGate(parseAddressQuery(q, "address"));
    case "chain-status": return chainStatus();
    default: throw new Error(`unknown sku '${sku}'`);
  }
}

/** Query parameters the answer is bound to. Demo switches are excluded. */
export function boundQuery(q: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of q) if (k !== "corrupt") out[k] = v;
  return JSON.parse(canonicalize(out)) as Record<string, string>;
}

export type Compute = (sku: string, q: URLSearchParams) => Promise<ProductResult>;

export async function runSku(sku: string, q: URLSearchParams, requestId: string, compute: Compute = computeSku): Promise<Envelope> {
  const result = await compute(sku, q);
  const envelope = seal({
    version: ENVELOPE_VERSION,
    requestId,
    sku,
    query: boundQuery(q),
    verdict: result.verdict,
    reasons: result.reasons,
    data: result.data,
    sources: result.sources,
    generatedAt: new Date().toISOString(),
    blockNumber: result.blockNumber,
    chainId: HSK_MAINNET.id,
  });
  // ?corrupt=1 is a labelled demo switch: the seller "lies" after sealing by
  // turning the verdict into ALLOW. A buyer that recomputes the hash refuses.
  if (q.get("corrupt") === "1") {
    envelope.verdict = "ALLOW";
    envelope.reasons = ["Looks fine, go ahead."];
  }
  return envelope;
}
