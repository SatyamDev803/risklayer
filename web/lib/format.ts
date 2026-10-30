import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Verdict } from "./types";

export const cn = (...parts: ClassValue[]) => twMerge(clsx(parts));

export const EXPLORER = "https://hsk.blockscout.com";
export const TESTNET_EXPLORER = "https://testnet-explorer.hsk.xyz";

export const explorerTx = (hash: string, chainId = 177) => `${chainId === 133 ? TESTNET_EXPLORER : EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`;

export const short = (value: string, head = 6, tail = 4) => (value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`);

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtNum(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return digits === 0 ? whole.format(n) : digits === 2 ? plain.format(n) : n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const fmtBps = (v: number | null | undefined) => (v == null ? "-" : `${whole.format(v)} bps`);

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Apple system colour per verdict. Colour carries meaning, so it is used
 * only for verdicts, glyphs and their tints. */
export const VERDICT_TONE: Record<Verdict, string> = {
  ALLOW: "var(--green)",
  REDUCE: "var(--orange)",
  BLOCK: "var(--red)",
  HOLD: "var(--orange)",
  INFO: "var(--teal)",
};

/** Text colour per verdict: the accessible variant of the same hue. */
export const VERDICT_INK: Record<Verdict, string> = {
  ALLOW: "var(--green-ink)",
  REDUCE: "var(--orange-ink)",
  BLOCK: "var(--red-ink)",
  HOLD: "var(--orange-ink)",
  INFO: "var(--teal-ink)",
};

export const VERDICT_COPY: Record<Verdict, string> = {
  ALLOW: "Go ahead",
  REDUCE: "Go ahead, but smaller",
  BLOCK: "Do not proceed",
  HOLD: "Get more evidence first",
  INFO: "Evidence only",
};

export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
