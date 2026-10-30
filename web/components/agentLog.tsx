"use client";

import { ArrowRightLeft, BadgeCheck, CircleDot, Flag, Search, ShieldX, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn, VERDICT_TONE } from "@/lib/format";
import type { AgentEvent } from "@/lib/types";

type Item = { icon: LucideIcon; tint: string; title: React.ReactNode; notes: string[] };

/** Groups the raw event stream into steps: a step title, the notes under it,
 * and the outcome that closed it. */
function toItems(events: AgentEvent[]): Item[] {
  const items: Item[] = [];
  const current = () => items[items.length - 1];
  for (const e of events) {
    if (e.type === "step") items.push({ icon: e.title.startsWith("Discover") ? Search : e.title.startsWith("Allowed") ? ArrowRightLeft : CircleDot, tint: "var(--blue)", title: e.title, notes: [] });
    else if (e.type === "note") current()?.notes.push(e.text);
    else if (e.type === "answer" && current()) {
      current().icon = BadgeCheck;
      current().tint = VERDICT_TONE[e.verdict];
      current().notes.push(`Verified. ${e.verdict}: ${e.reasons[0]}`);
    } else if (e.type === "rejected" && current()) {
      current().icon = ShieldX;
      current().tint = "var(--red)";
      current().notes.push("The answer failed verification. Refused.");
    } else if (e.type === "swap-plan") current()?.notes.push(`Fresh quote ${e.freshQuote} ${e.tokenOut}. Minimum accepted ${e.minimumOut}, a ${e.slippageBps} bps slippage floor.`);
    else if (e.type === "done") items.push({ icon: Flag, tint: e.outcome === "refused" || e.outcome === "stopped" ? "var(--red)" : "var(--green)", title: e.summary, notes: [] });
  }
  return items;
}

export function AgentLog({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const items = toItems(events);
  return (
    <ol className="space-y-1 px-3 pb-3" aria-label="What the agent did">
      <AnimatePresence initial={false}>
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.li
              key={i}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="flex items-start gap-3 rounded-2xl px-2 py-2.5"
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: item.tint }}>
                <Icon className="size-3.5" strokeWidth={2.6} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-snug">{item.title}</p>
                {item.notes.map((n, j) => (
                  <p key={j} className="num mt-0.5 text-[13px] leading-snug text-label-2">{n}</p>
                ))}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
      {running && (
        <li className="flex items-center gap-3 px-2 py-2.5 text-[14px] text-label-2">
          <span className={cn("relative flex size-7 shrink-0 items-center justify-center")}>
            <span className="absolute size-3 animate-ping rounded-full bg-blue opacity-40" />
            <span className="size-2 rounded-full bg-blue" />
          </span>
          Working
        </li>
      )}
    </ol>
  );
}
