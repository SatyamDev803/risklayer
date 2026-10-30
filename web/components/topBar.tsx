"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/format";
import type { Link } from "@/lib/useRisklayer";
import { Logo } from "./logo";
import { ThemeToggle } from "./themeToggle";

const SECTIONS = [
  { href: "#check", label: "Check" },
  { href: "#how", label: "How it works" },
  { href: "#activity", label: "Activity" },
  { href: "#connect", label: "Connect" },
];

export function TopBar({ link, payments }: { link: Link; payments?: string }) {
  const [open, setOpen] = useState(false);
  const status = link === "live" ? "Live on HSK mainnet" : link === "connecting" ? "Connecting" : "API offline";
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-[var(--glass)] backdrop-blur-2xl backdrop-saturate-150" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <a href="#top" aria-label="Risklayer, back to top" className="flex shrink-0 items-center gap-2">
          <Logo className="size-7" />
          <span className="font-display text-[18px] font-semibold tracking-[-0.025em]" translate="no">Risklayer</span>
        </a>

        <nav aria-label="Sections" className="ml-4 hidden lg:block">
          <ul className="flex items-center gap-1">
            {SECTIONS.map(s => (
              <li key={s.href}>
                <a href={s.href} className="rounded-full px-3 py-1.5 text-[14px] text-label-2 transition-colors hover:bg-fill hover:text-label">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span role="status" aria-live="polite" title={payments} className="hidden items-center gap-2 whitespace-nowrap text-[13px] font-medium text-label-2 sm:inline-flex">
            <span className={cn("size-2 rounded-full", link === "live" ? "bg-green" : link === "connecting" ? "bg-label-3" : "bg-red")} aria-hidden="true" />
            {status}
          </span>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls="section-menu"
            aria-label="Sections"
            className="grid size-9 place-items-center rounded-full bg-fill transition-[background-color,transform] duration-150 hover:bg-fill-strong active:scale-[0.97] lg:hidden"
          >
            <Menu className="size-[18px]" />
          </button>
        </div>
      </div>
      {open && (
        <nav id="section-menu" aria-label="Sections" className="border-t border-hairline px-4 pb-3 pt-2 lg:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {SECTIONS.map(s => (
              <li key={s.href}>
                <a href={s.href} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-xl px-3 text-[15px] font-medium hover:bg-fill">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
