/**
 * Append-only JSONL activity log. Every answer the seller serves (paid,
 * preview, or failed) is recorded so /v1/activity and the dashboard show a
 * real feed of what was asked, paid, decided and recorded.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ActivityEntry {
  ts: string;
  requestId?: string;
  sku: string;
  query: Record<string, string>;
  mode: "paid" | "preview";
  verdict?: string;
  reasons?: string[];
  resultHash?: string;
  blockNumber?: number;
  payment?: { mode: "hsp" | "local"; status: string; simulated: boolean; payer?: string; tx?: string; network: string; amountUsd: string };
  receiptTx?: string;
  ok: boolean;
  error?: string;
}

const LOG_PATH = process.env.ACTIVITY_LOG?.trim() || join(process.cwd(), "activity.jsonl");

/** Never throws: logging must not break a paid response. */
export function recordActivity(entry: ActivityEntry): void {
  try {
    appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.warn("[activity] log write failed:", error instanceof Error ? error.message : error);
  }
}

/** Newest first, capped. Returns [] when no log exists yet. */
export function readActivity(limit = 100): ActivityEntry[] {
  try {
    if (!existsSync(LOG_PATH)) return [];
    return readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean).slice(-limit).reverse().flatMap(line => {
      try {
        return [JSON.parse(line) as ActivityEntry];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
