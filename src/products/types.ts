import type { Source, Verdict } from "../verdict/envelope.js";

/** What a product computes before it is bound to a request and sealed. */
export interface ProductResult {
  verdict: Verdict;
  reasons: string[];
  data: Record<string, unknown>;
  sources: Source[];
  blockNumber: number;
}
