"use client";

import { ArrowRight, Play } from "lucide-react";
import { motion, type Variants } from "motion/react";

import { fmtBps, fmtNum, tint, VERDICT_INK, VERDICT_TONE } from "@/lib/format";
import { SAMPLE_SIZES, useLiveSamples } from "@/lib/useRisklayer";
import { RUN_AGENT_EVENT } from "./checkConsole";

function watchAgent() {
  document.getElementById("check")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.dispatchEvent(new Event(RUN_AGENT_EVENT));
}

const RISE: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
};

export function Overview() {
  const samples = useLiveSamples();
  const block = Object.values(samples).find(Boolean)?.blockNumber;
  return (
    <section id="top" className="grid min-h-[calc(100svh-250px)] scroll-mt-20 content-center items-center gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-[4vh]">
      <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.09 } } }}>
        <motion.p variants={RISE} className="inline-flex items-center gap-2 text-[15px] font-medium text-blue">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-blue" />
          </span>
          Pre-trade checks for AI agents on HSK Chain
        </motion.p>
        <motion.h1
          variants={RISE}
          className="mt-4 max-w-[15ch] bg-linear-to-br from-label via-label to-blue bg-clip-text pb-1 font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-transparent sm:text-[64px] lg:text-[clamp(44px,8vh,78px)]"
        >
          Ask before you move money.
        </motion.h1>
        <motion.p variants={RISE} className="mt-5 max-w-[54ch] text-[17px] leading-relaxed text-label-2 sm:text-[19px] lg:mt-[2.5vh]">
          An AI trading agent asks Risklayer whether a swap is safe and pays for the answer itself, with real USDC and no human in the loop. It checks the proof, obeys the verdict, and every paid answer is recorded on HSK mainnet.
        </motion.p>
        <motion.div variants={RISE} className="mt-8 flex flex-wrap items-center gap-3">
          <button type="button" onClick={watchAgent} className="inline-flex h-12 items-center gap-2 rounded-full bg-blue px-6 text-[17px] font-semibold text-white shadow-[0_8px_24px_-8px_var(--blue)] transition hover:brightness-110 active:scale-[0.97]">
            <Play className="size-4 fill-current" aria-hidden="true" /> Watch an agent pay
          </button>
          <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-full bg-fill px-5 text-[16px] font-medium transition hover:bg-fill-strong active:scale-[0.97]">
            How it works
          </a>
        </motion.div>
        <motion.p variants={RISE} className="num mt-5 text-[14px] text-label-2">
          {block ? `One click, about 30 seconds, two real payments. Reading HSK mainnet at block ${fmtNum(block, 0)}.` : "One click, about 30 seconds, two real payments."}
        </motion.p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.25 }}
        className="rounded-[28px] bg-surface p-5 shadow-card sm:p-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em]">Right now on HSKSwap</h2>
          <span className="text-[13px] text-label-2">USDT into WHSK</span>
        </div>
        <p className="mt-1 text-[13px] text-label-2">Same pool, three sizes, one limit of 100 bps. Computed live.</p>
        <ul className="mt-4 space-y-2.5">
          {SAMPLE_SIZES.map((size, i) => {
            const p = samples[size];
            const tone = p ? VERDICT_TONE[p.verdict] : "var(--label-3)";
            const ink = p ? VERDICT_INK[p.verdict] : "var(--label-3)";
            const impact = p?.reasons[0]?.match(/(\d+) bps/)?.[1];
            return (
              <motion.li
                key={size}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 24, delay: 0.4 + i * 0.08 }}
                className="flex items-center gap-4 rounded-2xl px-4 py-3.5"
                style={{ background: tint(tone, 10) }}
              >
                <div className="min-w-0 flex-1">
                  <div className="num font-display text-[22px] font-semibold tracking-[-0.02em]">{fmtNum(size, 0)} USDT</div>
                  <div className="num text-[13px] text-label-2">{p ? (impact ? `${fmtBps(Number(impact))} price impact` : p.reasons[0]) : "Asking the pool"}</div>
                </div>
                <span className="font-display text-[17px] font-semibold tracking-[-0.01em]" style={{ color: ink }} translate="no">
                  {p ? p.verdict : "…"}
                </span>
              </motion.li>
            );
          })}
        </ul>
        <button type="button" onClick={watchAgent} className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-blue hover:underline">
          Watch an agent pay for the 60,000 check <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </motion.div>
    </section>
  );
}
