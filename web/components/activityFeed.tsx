"use client";

import { AnimatePresence, motion } from "motion/react";

import { chainOfNetwork, explorerTx, short, timeAgo, VERDICT_INK, VERDICT_TONE } from "@/lib/format";
import type { ActivityEntry } from "@/lib/types";
import { Card } from "./ui/card";

function describe(q: Record<string, string>): string {
  if (q.amountIn && q.tokenIn) return `${Number(q.amountIn).toLocaleString("en-US")} ${q.tokenIn} into ${q.tokenOut}`;
  if (q.address) return short(q.address);
  if (q.token) return short(q.token);
  if (q.tokenA) return `${q.tokenA} and ${q.tokenB}`;
  return "HSK Chain";
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card id="activity" title="Paid answers" aside={entries.length ? `${entries.length} most recent` : undefined} className="mt-14">
      <p className="px-5 pt-1 text-[13px] text-label-2">Every answer an agent paid for, with its proof, payment and receipt. Updates on its own.</p>
      <ol className="mt-3 max-h-[560px] overflow-y-auto px-3 pb-3">
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            const tone = e.ok && e.verdict ? VERDICT_TONE[e.verdict] : "var(--red)";
            const ink = e.ok && e.verdict ? VERDICT_INK[e.verdict] : "var(--red-ink)";
            return (
              <motion.li
                key={`${e.requestId ?? e.ts}-${i}`}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className="flex items-start gap-3 rounded-2xl px-2 py-2.5"
              >
                <span className="mt-0.5 grid h-7 min-w-16 shrink-0 place-items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: ink }} translate="no">
                  {e.ok ? e.verdict : "FAILED"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug">
                    <span className="font-medium">{e.sku}</span> <span className="text-label-2">{describe(e.query)}</span>
                  </p>
                  <p className="text-[14px] leading-snug text-label-2">{e.ok ? e.reasons?.[0] : e.error}</p>
                  <p className="num mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-label-3">
                    <time dateTime={e.ts}>{timeAgo(e.ts)}</time>
                    {e.payment && <span>${e.payment.amountUsd} {e.payment.mode === "hsp" ? "via HSP" : e.payment.simulated ? "simulated" : e.payment.network === "sepolia" ? "USDC on Sepolia" : "via local gateway"}</span>}
                    {e.payment?.tx && <a className="text-blue hover:underline" href={explorerTx(e.payment.tx, chainOfNetwork(e.payment.network))} target="_blank" rel="noreferrer">USDC transfer ↗</a>}
                    {e.receiptTx && <a className="text-blue hover:underline" href={explorerTx(e.receiptTx)} target="_blank" rel="noreferrer">Receipt on HSK ↗</a>}
                  </p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {!entries.length && <li className="px-2 py-10 text-center text-[15px] text-label-2">No paid answers yet. Run the paid agent above and they appear here.</li>}
      </ol>
    </Card>
  );
}
