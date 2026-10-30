/**
 * The answer envelope every paid SKU returns, and the buyer-side check.
 *
 * resultHash = sha256(canonicalJSON(hashed fields)). The hashed fields bind
 * the answer to the request (requestId, sku, query) and to a point in chain
 * time (blockNumber, generatedAt), so a valid answer to a different or older
 * question fails verification even though its own hash is internally fine.
 *
 * What the hash proves: the hashed content is what the seller produced.
 * What it does not prove: that the underlying data is true.
 */
import { canonicalize, sha256Hex } from "./canonical.js";

export const ENVELOPE_VERSION = "risklayer/1";

export type Verdict = "ALLOW" | "REDUCE" | "BLOCK" | "HOLD" | "INFO";
export const VERDICTS: readonly Verdict[] = ["ALLOW", "REDUCE", "BLOCK", "HOLD", "INFO"];

export interface Source {
  type: string;
  /** Contract or endpoint the value came from. */
  ref: string;
  blockNumber?: number;
  observedAt?: string;
  note?: string;
}

export interface Envelope {
  version: string;
  requestId: string;
  sku: string;
  /** Canonical query parameters the buyer asked with. */
  query: Record<string, string>;
  verdict: Verdict;
  reasons: string[];
  data: Record<string, unknown>;
  sources: Source[];
  proof: {
    resultHash: string;
    generatedAt: string;
    blockNumber: number;
    chainId: number;
    hashedFields: string[];
  };
}

export type Unsigned = Omit<Envelope, "proof"> & { generatedAt: string; blockNumber: number; chainId: number };

const HASHED_FIELDS = ["version", "requestId", "sku", "query", "verdict", "reasons", "data", "sources", "generatedAt", "blockNumber", "chainId"] as const;

export function hashInput(e: Unsigned): string {
  const picked: Record<string, unknown> = {};
  for (const field of HASHED_FIELDS) picked[field] = e[field];
  return canonicalize(picked);
}

export function seal(e: Unsigned): Envelope {
  const { generatedAt, blockNumber, chainId, ...rest } = e;
  return {
    ...rest,
    proof: {
      resultHash: `sha256:${sha256Hex(hashInput(e))}`,
      generatedAt,
      blockNumber,
      chainId,
      hashedFields: [...HASHED_FIELDS],
    },
  };
}

export function recomputeHash(env: Envelope): string {
  return `sha256:${sha256Hex(
    hashInput({ ...env, generatedAt: env.proof.generatedAt, blockNumber: env.proof.blockNumber, chainId: env.proof.chainId }),
  )}`;
}

export interface Expectation {
  requestId: string;
  sku: string;
  query: Record<string, string>;
  maxAgeSec?: number;
  /** Latest block the buyer observed; answers older than maxBlockLag fail. */
  currentBlock?: number;
  maxBlockLag?: number;
  now?: number;
}

/** Buyer-side verification. An empty list means the answer may be acted on. */
export function verifyEnvelope(env: Envelope, expect: Expectation): string[] {
  const problems: string[] = [];
  if (env?.version !== ENVELOPE_VERSION) problems.push(`unknown envelope version '${env?.version}'`);
  if (!env?.proof?.resultHash) return [...problems, "missing proof"];
  const recomputed = recomputeHash(env);
  if (recomputed !== env.proof.resultHash) problems.push(`result hash mismatch: recomputed ${recomputed.slice(0, 23)}… but the answer claims ${env.proof.resultHash.slice(0, 23)}…`);
  if (env.requestId !== expect.requestId) problems.push(`answer is for request ${env.requestId}, expected ${expect.requestId}`);
  if (env.sku !== expect.sku) problems.push(`answer is for sku ${env.sku}, expected ${expect.sku}`);
  if (canonicalize(env.query) !== canonicalize(expect.query)) problems.push("answer query does not match the question asked");
  if (!VERDICTS.includes(env.verdict)) problems.push(`unknown verdict '${env.verdict}'`);
  const age = ((expect.now ?? Date.now()) - Date.parse(env.proof.generatedAt)) / 1000;
  const maxAge = expect.maxAgeSec ?? 180;
  if (!Number.isFinite(age) || age > maxAge) problems.push(`stale answer: ${Math.round(age)}s old, limit ${maxAge}s`);
  if (expect.currentBlock !== undefined) {
    const lag = expect.currentBlock - env.proof.blockNumber;
    if (lag > (expect.maxBlockLag ?? 120)) problems.push(`answer evidence is ${lag} blocks behind the chain tip`);
  }
  if (!Array.isArray(env.sources) || env.sources.length === 0) problems.push("answer cites no sources");
  return problems;
}
