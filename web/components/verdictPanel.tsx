"use client";

import { Check, ChevronRight, Minus, ShieldX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { cn, explorerAddress, explorerTx, fmtBps, fmtNum, short, tint, VERDICT_COPY, VERDICT_INK } from "@/lib/format";
import type { AgentEvent, Preview, Verdict } from "@/lib/types";
import { Group } from "./ui/card";

type Answer = Extract<AgentEvent, { type: "answer" }>;
type Rejected = Extract<AgentEvent, { type: "rejected" }>;

const SPRING = { type: "spring", stiffness: 260, damping: 28 } as const;

function Headline({ verdict, sub, eyebrow }: { verdict: Verdict | "REFUSED"; sub: string; eyebrow: string }) {
  const tone = verdict === "REFUSED" ? "var(--red-ink)" : VERDICT_INK[verdict];
  return (
    <div className="px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="num text-[15px] text-label-2">{eyebrow}</div>
      <motion.div
        key={verdict + eyebrow}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1"
      >
        <span translate="no" className="font-display text-[56px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[72px]" style={{ color: tone }}>
          {verdict === "REFUSED" ? "Refused" : verdict.charAt(0) + verdict.slice(1).toLowerCase()}
        </span>
        <span className="text-[17px] font-medium text-label-2">{sub}</span>
      </motion.div>
    </div>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  return (
    <ul className="mt-3 space-y-1 px-5 text-[17px] leading-snug sm:px-6">
      {reasons.map(r => <li key={r}>{r}</li>)}
    </ul>
  );
}

/** Where this trade's price impact sits against the buyer's limit and the hard limit. */
function ImpactMeter({ impact, limit, hard }: { impact: number; limit: number; hard: number }) {
  const scale = Math.max(hard * 1.1, impact * 1.05, limit * 4);
  const pos = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const tone = impact > hard ? "var(--red)" : impact > limit ? "var(--orange)" : "var(--green)";
  const ink = impact > hard ? "var(--red-ink)" : impact > limit ? "var(--orange-ink)" : "var(--green-ink)";
  return (
    <div className="mx-5 mt-5 rounded-2xl bg-surface-2 p-4 sm:mx-6">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-label-2">Price impact of this size</span>
        <span className="num font-display text-[22px] font-semibold tracking-[-0.02em]" style={{ color: ink }}>{fmtBps(impact)}</span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-fill" role="img" aria-label={`Price impact ${impact} basis points, your limit ${limit}, hard limit ${hard}`}>
        <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: tone }} initial={{ width: 0 }} animate={{ width: pos(impact) }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-label" style={{ left: pos(limit) }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-red" style={{ left: pos(hard) }} />
      </div>
      <div className="num mt-2 flex justify-between gap-3 text-[12px] text-label-2">
        <span>Your limit {fmtBps(limit)}</span>
        <span>Hard limit {fmtBps(hard)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, caption, href }: { label: string; value: React.ReactNode; caption?: string; href?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {caption && (
          <div className="truncate text-[12px] text-label-2">
            {href ? <a href={href} target="_blank" rel="noreferrer" className="text-blue hover:underline">{caption}</a> : caption}
          </div>
        )}
      </div>
      <div className="num min-w-0 shrink-0 text-right text-[15px] font-medium break-words">{value}</div>
    </li>
  );
}

function Glyph({ pass }: { pass: boolean | null }) {
  return (
    <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full text-white", pass === true ? "bg-green" : pass === false ? "bg-red" : "bg-label-3")} aria-hidden="true">
      {pass === true ? <Check className="size-3.5" strokeWidth={3} /> : pass === false ? <X className="size-3.5" strokeWidth={3} /> : <Minus className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="px-5 pb-2 pt-6 text-[15px] font-semibold sm:px-6">{children}</h3>;
}

export function AnswerPanel({ answer }: { answer: Answer }) {
  const [raw, setRaw] = useState(false);
  const d = answer.data as Record<string, any>;
  const checks = (d.checks ?? []) as { name: string; pass: boolean | null; detail: string }[];
  const pool = d.pool as { address: string; feeTier: number } | undefined;
  const isTrade = answer.sku === "trade-gate";
  return (
    <div className="pb-5">
      <Headline verdict={answer.verdict} sub={VERDICT_COPY[answer.verdict]} eyebrow={`${isTrade ? `${fmtNum(d.amountIn, 0)} ${d.tokenIn?.symbol} into ${d.tokenOut?.symbol}` : answer.sku} · block ${fmtNum(answer.blockNumber, 0)}`} />
      <Reasons reasons={answer.reasons} />
      {isTrade && typeof d.priceImpactBps === "number" && <ImpactMeter impact={d.priceImpactBps} limit={d.maxImpactBps} hard={d.hardImpactBps ?? 1500} />}

      {isTrade && (
        <>
          <SectionTitle>Evidence</SectionTitle>
          <Group className="mx-3">
            <Row label="Quoted out" value={`${fmtNum(d.quotedAmountOut)} ${d.tokenOut?.symbol}`} caption="HSKSwap QuoterV2" />
            {d.recommendedAmountIn && <Row label="Largest safe size" value={`${fmtNum(d.recommendedAmountIn, 0)} ${d.tokenIn?.symbol}`} caption="Searched on live quotes" />}
            <Row label="Spot against 10 min average" value={d.twapDeviationBps == null ? "Unavailable" : fmtBps(d.twapDeviationBps)} caption={pool ? `Pool ${short(pool.address)}, ${pool.feeTier / 10_000}% fee` : undefined} href={pool ? explorerAddress(pool.address) : undefined} />
            <Row label="Spot against APRO oracle" value={d.oracleDeviationBps == null ? "Unavailable" : fmtBps(d.oracleDeviationBps)} caption="APRO price feeds on HSK" />
            <Row label="Chain freshness" value={`${d.blockAgeSec}s`} caption="Since the latest HSK block" />
          </Group>
        </>
      )}

      {checks.length > 0 && (
        <>
          <SectionTitle>Rules, checked in order</SectionTitle>
          <Group className="mx-3">
            {checks.map(c => (
              <li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
                <Glyph pass={c.pass} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] first-letter:uppercase">{c.name}</div>
                  <div className="num truncate text-[13px] text-label-2">{c.detail}</div>
                </div>
                <span className="sr-only">{c.pass === true ? "passed" : c.pass === false ? "failed" : "skipped"}</span>
              </li>
            ))}
          </Group>
        </>
      )}

      <SectionTitle>Proof and payment</SectionTitle>
      <Group className="mx-3">
        <Row label="Result hash" value={<span className="font-mono text-[13px]" translate="no">{short(answer.resultHash.replace("sha256:", ""), 8, 6)}</span>} caption="Recomputed by the agent, matched" />
        <Row
          label="Paid"
          value={`$${answer.payment.amountUsd}`}
          caption={answer.payment.tx ? `USDC transfer ${short(answer.payment.tx)}` : answer.payment.simulated ? "Verified, simulated, not broadcast" : answer.payment.status}
          href={answer.payment.tx ? explorerTx(answer.payment.tx, answer.payment.chainId) : undefined}
        />
        <Row label="Settled through" value={answer.payment.mode === "hsp" ? "HSP" : "Local gateway"} caption={answer.payment.label} />
        <Row
          label="Receipt on HSK"
          value={answer.receipt?.tx ? "Recorded" : "Off"}
          caption={answer.receipt?.tx ? `Transaction ${short(answer.receipt.tx)}` : answer.receipt?.error ?? "Deploy RisklayerReceipts to turn on"}
          href={answer.receipt?.tx ? explorerTx(answer.receipt.tx) : undefined}
        />
      </Group>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => setRaw(r => !r)}
          aria-expanded={raw}
          className="flex w-full items-center gap-2 rounded-2xl px-2 py-2.5 text-left text-[15px] text-blue transition-colors hover:bg-fill"
        >
          <ChevronRight className={cn("size-4 transition-transform", raw && "rotate-90")} aria-hidden="true" />
          {raw ? "Hide the raw answer" : "Show the raw answer"}
        </button>
        <AnimatePresence initial={false}>
          {raw && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="overflow-hidden">
              <pre translate="no" className="mx-2 mb-1 max-h-96 overflow-auto rounded-2xl bg-surface-2 p-4 font-mono text-[12px] leading-relaxed text-label-2">{JSON.stringify(answer, null, 2)}</pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function RejectedPanel({ event }: { event: Rejected }) {
  return (
    <div className="pb-5">
      <Headline verdict="REFUSED" sub="The agent will not act on this answer" eyebrow={`Stopped at ${event.stage === "verify" ? "verification" : event.stage}`} />
      {event.claimedVerdict && (
        <div className="mx-5 mt-4 flex items-start gap-3 rounded-2xl p-4 sm:mx-6" style={{ background: tint("var(--red)", 10) }}>
          <ShieldX className="mt-0.5 size-5 shrink-0 text-[var(--red-ink)]" aria-hidden="true" />
          <p className="text-[15px] leading-snug">
            The seller said <span className="font-semibold" style={{ color: VERDICT_INK[event.claimedVerdict] }} translate="no">{event.claimedVerdict}</span>, but that is not what it signed. The agent recomputed the hash, saw the mismatch, and kept its money still.
          </p>
        </div>
      )}
      <SectionTitle>What failed</SectionTitle>
      <Group className="mx-3">
        {event.problems.map(p => (
          <li key={p} className="flex items-start gap-3 px-4 py-2.5">
            <Glyph pass={false} />
            <span className="num min-w-0 break-words text-[14px] leading-snug first-letter:uppercase">{p}</span>
          </li>
        ))}
      </Group>
    </div>
  );
}

export function PreviewPanel({ preview }: { preview: Preview }) {
  return (
    <div className="pb-5">
      <Headline verdict={preview.verdict} sub={VERDICT_COPY[preview.verdict]} eyebrow={`Free preview · block ${fmtNum(preview.blockNumber, 0)}`} />
      <Reasons reasons={preview.reasons} />
      <p className="mx-5 mt-5 rounded-2xl bg-surface-2 p-4 text-[15px] leading-snug text-label-2 sm:mx-6">
        The preview has no evidence, no proof and no receipt. An agent pays for those, then checks the proof before it trusts the answer. Switch to the paid agent to watch it happen.
      </p>
    </div>
  );
}
