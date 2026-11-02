"use client";

import { ArrowUpDown, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/format";
import type { AgentEvent, Preview } from "@/lib/types";
import { AgentLog } from "./agentLog";
import { PaymentTrail } from "./paymentTrail";
import { Card, Group } from "./ui/card";
import { Segmented } from "./ui/segmented";
import { Switch } from "./ui/switch";
import { AnswerPanel, PreviewPanel, RejectedPanel } from "./verdictPanel";

const TOKENS = ["USDT", "USDC", "WHSK", "WETH", "WBTC"];
const LIMITS = [
  { value: "50", label: "50 bps" },
  { value: "100", label: "100 bps" },
  { value: "300", label: "300 bps" },
];
type Mode = "agent" | "preview";

/** Fired by the hero button: run the paid agent on the showcase trade. */
export const RUN_AGENT_EVENT = "risklayer:run-agent";

export function CheckConsole({ notify }: { notify: (text: string, tone?: "ok" | "error") => void }) {
  const [tokenIn, setTokenIn] = useState("USDT");
  const [tokenOut, setTokenOut] = useState("WHSK");
  const [amountIn, setAmountIn] = useState("60000");
  const [maxImpactBps, setMaxImpactBps] = useState("100");
  const [tamper, setTamper] = useState(false);
  const [mode, setMode] = useState<Mode>("agent");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Mode | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const abort = useRef<AbortController | null>(null);

  const problem = !/^\d+(\.\d+)?$/.test(amountIn) || Number(amountIn) <= 0 ? "Enter an amount above zero." : tokenIn === tokenOut ? "Pick two different tokens." : null;

  async function run(over?: { mode: Mode; tokenIn: string; tokenOut: string; amountIn: string; maxImpactBps: string; tamper: boolean }) {
    const p = over ?? { mode, tokenIn, tokenOut, amountIn, maxImpactBps, tamper };
    if (!over && problem) return notify(problem, "error");
    if (busy) return;
    setBusy(true);
    setShown(p.mode);
    try {
      if (p.mode === "preview") {
        const { tokenIn, tokenOut, amountIn, maxImpactBps } = p;
        const qs = new URLSearchParams({ tokenIn, tokenOut, amountIn, maxImpactBps });
        const res = await fetch(`/api/rl/preview/trade-gate?${qs}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "The check did not complete.");
        setPreview(body as Preview);
        return;
      }
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setEvents([]);
      const res = await fetch("/api/rl/v1/demo/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountIn, maxImpactBps: Number(p.maxImpactBps), corrupt: p.tamper }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 404 ? "The paid agent is off on this server. Start the API with DEMO_AGENT=1." : res.status === 429 ? "The agent is busy or has hit its hourly limit. Try again in a minute." : (body.error ?? "The agent could not start."));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const parsed = lines.filter(Boolean).map(l => JSON.parse(l) as AgentEvent);
        if (parsed.length) setEvents(prev => [...prev, ...parsed]);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        notify((e as Error).message, "error");
        setShown(null);
      }
    } finally {
      setBusy(false);
    }
  }

  // The hero button runs the showcase trade: 60,000 USDT is too big for the pool, so the agent reduces, re-checks, and is allowed.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onRun = () => {
      const showcase = { mode: "agent" as const, tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", maxImpactBps: "100", tamper: false };
      setMode("agent");
      setTokenIn(showcase.tokenIn);
      setTokenOut(showcase.tokenOut);
      setAmountIn(showcase.amountIn);
      setMaxImpactBps(showcase.maxImpactBps);
      setTamper(false);
      void runRef.current(showcase);
    };
    window.addEventListener(RUN_AGENT_EVENT, onRun);
    return () => window.removeEventListener(RUN_AGENT_EVENT, onRun);
  }, []);

  const lastAnswer = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "answer" }> => e.type === "answer" && e.sku === "trade-gate");
  const quotedOut = lastAnswer?.data.quotedAmountOut;
  const quoted = typeof quotedOut === "number" && lastAnswer?.data.tokenOut && (lastAnswer.data.tokenOut as { symbol: string }).symbol === tokenOut ? quotedOut.toLocaleString("en-US", { maximumFractionDigits: 2 }) : null;
  const resultRef = useRef<HTMLDivElement>(null);
  const resultKey = shown === "preview" ? preview?.blockNumber : events.filter(e => e.type === "answer" || e.type === "rejected").length;
  // On phones the verdict sits below the form: bring it into view when it lands.
  useEffect(() => {
    if (!resultKey || window.innerWidth >= 1024) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [resultKey]);

  const last = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "answer" | "rejected" }> => e.type === "answer" || e.type === "rejected");

  return (
    <section id="check" className="grid scroll-mt-20 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 lg:gap-5">
        <Card title="Ask Risklayer" aside={<Segmented label="Check type" value={mode} onChange={setMode} options={[{ value: "agent", label: "Paid agent" }, { value: "preview", label: "Free preview" }]} className="w-[220px]" />}>
          <p className="px-5 pt-1 text-[13px] text-label-2">
            {mode === "agent" ? "A trading agent pays 0.25 USDC for each check, a real transfer on chain. It verifies the proof and follows the verdict. It stops before sending any swap." : "The verdict and the reasons, free. No evidence, proof or receipt."}
          </p>

          <form
            className="px-3 pb-4 pt-4"
            onSubmit={e => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="relative">
              <Group>
                <li className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="amount" className="text-[13px] text-label-2">You swap</label>
                    <input
                      id="amount"
                      name="amountIn"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={amountIn}
                      onChange={e => setAmountIn(e.target.value.replace(/[^\d.]/g, ""))}
                      className="num block w-full min-w-0 bg-transparent font-display text-[28px] font-semibold tracking-[-0.02em] outline-none"
                    />
                  </div>
                  <TokenPicker label="Token you pay" name="tokenIn" value={tokenIn} onChange={setTokenIn} />
                </li>
                <li className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-label-2">For about</div>
                    {quoted ? (
                      <div className="num truncate font-display text-[28px] font-semibold tracking-[-0.02em] text-label-2">{quoted}</div>
                    ) : (
                      <div className="flex h-[42px] items-center text-[17px] text-label-3">Quoted live after the check</div>
                    )}
                  </div>
                  <TokenPicker label="Token you get" name="tokenOut" value={tokenOut} onChange={setTokenOut} />
                </li>
              </Group>
              <button
                type="button"
                aria-label="Swap direction"
                onClick={() => {
                  setTokenIn(tokenOut);
                  setTokenOut(tokenIn);
                }}
                className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-surface bg-surface-2 text-label-2 transition-[transform,color] duration-150 hover:text-label active:scale-[0.94]"
              >
                <ArrowUpDown className="size-4" />
              </button>
            </div>

            <Group className="mt-3">
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-[15px]">Most price impact allowed</span>
                <Segmented label="Most price impact allowed" value={maxImpactBps} onChange={setMaxImpactBps} options={LIMITS} className="w-full sm:w-[240px]" />
              </li>
              {mode === "agent" && (
                <li className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px]">Tamper test</div>
                    <div className="text-[13px] leading-snug text-label-2">The seller changes its answer to ALLOW after signing it.</div>
                  </div>
                  <Switch label="Tamper test" checked={tamper} onChange={setTamper} />
                </li>
              )}
            </Group>

            <button
              type="submit"
              disabled={busy}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-blue text-[17px] font-semibold text-white transition-[filter,transform,opacity] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              <Sparkles className="size-[18px]" aria-hidden="true" />
              {busy ? (mode === "agent" ? "Agent is working…" : "Checking…") : mode === "agent" ? "Run the paid agent" : "Check for free"}
            </button>
          </form>
        </Card>
        {shown === "agent" && events.length > 0 && (
          <Card title="Agent log" aside={busy ? "Live" : "Finished"}>
            <p className="px-5 pb-2 pt-1 text-[13px] text-label-2">Every step the buyer took, in order.</p>
            <AgentLog events={events} running={busy} />
          </Card>
        )}
      </div>

      <div ref={resultRef} className="min-w-0 scroll-mt-20 lg:col-span-7" aria-live="polite" aria-busy={busy}>
        <Card className="min-h-full">
          {shown === "agent" && events.length > 0 && (
            <div className="pt-4">
              <div className="flex items-baseline justify-between px-5 pb-2 sm:px-6">
                <h3 className="font-display text-[17px] font-semibold tracking-[-0.02em]">Payment trail</h3>
                <span className="text-[13px] text-label-2">{busy ? "Live" : "Tap a step with an arrow to open it on chain"}</span>
              </div>
              <PaymentTrail events={events} running={busy} />
            </div>
          )}
          {shown === "agent" && last ? (
            last.type === "answer" ? <AnswerPanel key={last.requestId} answer={last} /> : <RejectedPanel event={last} />
          ) : shown === "preview" && preview && !busy ? (
            <PreviewPanel preview={preview} />
          ) : busy ? (
            <Waiting agent={shown === "agent"} compact={shown === "agent" && events.length > 0} />
          ) : (
            <Empty />
          )}
        </Card>
      </div>

    </section>
  );
}

function TokenPicker({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label={label}
        name={name}
        translate="no"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-10 appearance-none rounded-full bg-surface py-0 pl-4 pr-9 text-[16px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none"
      >
        {TOKENS.map(t => <option key={t} value={t}>{t === "USDC" ? "USDC.e" : t}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-label-2" aria-hidden="true" />
    </span>
  );
}

function Waiting({ agent, compact }: { agent: boolean; compact?: boolean }) {
  return (
    <div className={cn("grid place-items-center p-8 text-center", compact ? "min-h-[200px]" : "min-h-[420px]")}>
      <div>
        <span className="relative mx-auto flex size-12 items-center justify-center">
          <span className="absolute size-12 animate-ping rounded-full bg-blue opacity-20" />
          <span className="size-4 rounded-full bg-blue" />
        </span>
        <p className="mt-5 font-display text-[22px] font-semibold tracking-[-0.02em]">{agent ? "Buying the first check" : "Reading HSKSwap"}</p>
        <p className="mx-auto mt-1 max-w-[36ch] text-[15px] text-label-2">{agent ? "The verdict appears once payment settles and the agent has verified the proof." : "Live quote, 10 minute average and APRO oracle."}</p>
      </div>
    </div>
  );
}

function Empty() {
  const steps: [string, string, string][] = [
    ["Ask", "The agent asks whether a swap is safe at its size.", "var(--blue)"],
    ["Pay", "Risklayer answers 402 with signed terms. The agent pays 0.25 USDC, a real transfer you can open on Etherscan.", "var(--indigo)"],
    ["Verify", "The agent recomputes the answer's hash and checks it is for its own question.", "var(--teal)"],
    ["Obey", "Block stops it. Reduce shrinks the trade. Allow still takes a fresh quote first.", "var(--green)"],
  ];
  return (
    <div className="p-5 sm:p-6">
      <div className="text-[15px] text-label-2">Nothing checked yet</div>
      <h3 className="mt-1 font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[40px]">Try 60,000 USDT into WHSK.</h3>
      <p className="mt-2 max-w-[48ch] text-[17px] text-label-2">The pool is too thin for that size. Watch Risklayer say how much it can take, and the agent shrink the trade to fit.</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {steps.map(([title, body, color], i) => (
          <li key={title} className="rounded-2xl bg-surface-2 p-4">
            <span className={cn("num grid size-8 place-items-center rounded-full text-[15px] font-semibold")} style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
              {i + 1}
            </span>
            <p className="mt-3 text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
            <p className="mt-0.5 text-[14px] leading-snug text-label-2">{body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
