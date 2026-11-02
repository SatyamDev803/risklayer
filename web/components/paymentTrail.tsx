"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import { motion } from "motion/react";

import { cn, explorerTx, short, tint, VERDICT_INK, VERDICT_TONE } from "@/lib/format";
import type { AgentEvent, Verdict } from "@/lib/types";

type State = "done" | "active" | "todo" | "failed";
type Stage = { label: string; state: State; detail?: string; href?: string; tone?: string };
type Check = { title: string; stages: Stage[] };

/** One row per paid check the agent bought, built from the live event stream. */
function toChecks(events: AgentEvent[], running: boolean): Check[] {
  const checks: { title: string; seen: Set<string>; verdict?: Verdict; payTx?: string; payChain?: number; receiptTx?: string; receiptError?: string; simulated?: boolean; rejected?: boolean }[] = [];
  for (const e of events) {
    if (e.type === "step" && (e.title.startsWith("May I") || e.title.startsWith("Is the seller"))) checks.push({ title: e.title, seen: new Set(["asked"]) });
    const c = checks[checks.length - 1];
    if (!c) continue;
    if (e.type === "note") {
      if (e.text.startsWith("402")) c.seen.add("402");
      if (e.text.startsWith("Seller terms check out")) c.seen.add("terms");
      if (e.text.startsWith("Signed EIP-3009")) c.seen.add("signed");
      if (e.text.startsWith("Paid (")) c.seen.add("paid");
    } else if (e.type === "answer") {
      c.seen.add("paid").add("verified");
      c.verdict = e.verdict;
      c.payTx = e.payment.tx;
      c.payChain = e.payment.chainId;
      c.simulated = e.payment.simulated;
      c.receiptTx = e.receipt?.tx ?? undefined;
      c.receiptError = e.receipt?.error;
    } else if (e.type === "rejected") {
      c.seen.add("paid");
      c.rejected = true;
    }
  }

  return checks.map((c, i) => {
    const last = i === checks.length - 1;
    const order = ["asked", "402", "terms", "signed", "paid", "verified", "receipt"];
    const reached = (key: string) => (key === "receipt" ? !!c.receiptTx : c.seen.has(key));
    const firstOpen = order.find(k => !reached(k));
    const state = (key: string): State => {
      if (reached(key)) return "done";
      if (c.rejected && key === "verified") return "failed";
      if (c.rejected || !running || !last) return "todo";
      return key === firstOpen ? "active" : "todo";
    };
    const stages: Stage[] = [
      { label: "Asked", state: state("asked") },
      { label: "402 terms", state: state("402"), detail: "Signed by the seller" },
      { label: "Terms checked", state: state("terms"), detail: "Payee, token, price" },
      { label: "Signed", state: state("signed"), detail: "EIP-3009, gasless" },
      {
        label: c.simulated ? "Paid (simulated)" : "Paid $0.25",
        state: state("paid"),
        detail: c.payTx ? `USDC ${short(c.payTx, 6, 4)}` : undefined,
        href: c.payTx ? explorerTx(c.payTx, c.payChain) : undefined,
      },
      {
        label: c.rejected ? "Hash mismatch" : c.verdict ? `Verified: ${c.verdict}` : "Verified",
        state: state("verified"),
        detail: c.rejected ? "Refused to act" : "Hash recomputed",
        tone: c.verdict ? VERDICT_TONE[c.verdict] : undefined,
      },
      {
        label: "Receipt on HSK",
        state: c.rejected ? "todo" : state("receipt"),
        detail: c.receiptTx ? `Tx ${short(c.receiptTx, 6, 4)}` : c.receiptError ? "Not written" : c.verdict ? (c.simulated ? "Only for real payments" : "Writing") : undefined,
        href: c.receiptTx ? explorerTx(c.receiptTx) : undefined,
      },
    ];
    return { title: c.title, stages };
  });
}

export function PaymentTrail({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const checks = toChecks(events, running);
  if (!checks.length) return null;
  return (
    <div className="space-y-4 px-3 pb-4">
      {checks.map((check, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="rounded-2xl bg-surface-2 p-3">
          <p className="px-1 text-[13px] font-medium text-label-2">Check {i + 1}: {check.title}</p>
          <ol className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label={`Payment trail for check ${i + 1}`}>
            {check.stages.map(s => (
              <StageChip key={s.label} stage={s} />
            ))}
          </ol>
        </motion.div>
      ))}
    </div>
  );
}

function StageChip({ stage }: { stage: Stage }) {
  const color = stage.state === "failed" ? "var(--red)" : stage.tone && stage.state === "done" ? stage.tone : "var(--blue)";
  const ink = stage.state === "failed" ? "var(--red-ink)" : stage.tone && stage.state === "done" ? VERDICT_INK[stage.label.split(": ")[1] as Verdict] ?? "var(--label)" : "var(--label)";
  const inner = (
    <>
      <span className="flex items-center gap-1.5">
        <span
          className={cn("grid size-4 shrink-0 place-items-center rounded-full", stage.state === "todo" && "border border-label-3")}
          style={stage.state === "done" || stage.state === "failed" ? { background: color } : undefined}
        >
          {stage.state === "done" && <Check className="size-2.5 text-white" strokeWidth={3.5} aria-hidden="true" />}
          {stage.state === "failed" && <X className="size-2.5 text-white" strokeWidth={3.5} aria-hidden="true" />}
          {stage.state === "active" && (
            <span className="relative flex size-4 items-center justify-center">
              <span className="absolute size-4 animate-ping rounded-full bg-blue opacity-40" />
              <span className="size-2 rounded-full bg-blue" />
            </span>
          )}
        </span>
        <span className={cn("truncate text-[12px] font-semibold", stage.state === "todo" && "text-label-3")} style={stage.state !== "todo" ? { color: ink } : undefined} translate="no">
          {stage.label}
        </span>
        {stage.href && <ArrowUpRight className="ml-auto size-3 shrink-0 text-blue" aria-hidden="true" />}
      </span>
      {stage.detail && stage.state !== "todo" && <span className="num mt-0.5 block truncate text-[11px] text-label-2">{stage.detail}</span>}
      <span className="sr-only">{stage.state}</span>
    </>
  );
  const cls = "block min-w-0 rounded-xl px-2.5 py-2 transition-colors";
  const bg = stage.state === "done" || stage.state === "failed" ? tint(color, 12) : stage.state === "active" ? tint("var(--blue)", 8) : "transparent";
  return (
    <li>
      {stage.href ? (
        <a href={stage.href} target="_blank" rel="noreferrer" className={cn(cls, "hover:brightness-95")} style={{ background: bg }} title="Open in explorer">
          {inner}
        </a>
      ) : (
        <div className={cls} style={{ background: bg }}>
          {inner}
        </div>
      )}
    </li>
  );
}
