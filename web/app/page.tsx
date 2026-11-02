"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityFeed } from "@/components/activityFeed";
import { CheckConsole } from "@/components/checkConsole";
import { Connect } from "@/components/connect";
import { HowItWorks } from "@/components/howItWorks";
import { Overview } from "@/components/overview";
import { ProofStrip } from "@/components/proofStrip";
import { Toasts, type ToastMsg } from "@/components/toast";
import { TopBar } from "@/components/topBar";
import { useRisklayer } from "@/lib/useRisklayer";

const API_URL = (process.env.NEXT_PUBLIC_RISKLAYER_URL ?? "http://localhost:4021").replace(/\/$/, "");

export default function Dashboard() {
  const { catalogue, activity, link } = useRisklayer();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const nextId = useRef(1);

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600);
  }, []);

  return (
    <>
      <TopBar link={link} payments={catalogue?.payment.protocol} />
      <Toasts items={toasts} />
      <main className="mx-auto max-w-[1280px] px-4 pb-10 sm:px-6">
        <WakeBanner link={link} />
        <Overview />
        <ProofStrip catalogue={catalogue} activity={activity} />
        <CheckConsole notify={notify} />
        <HowItWorks />
        <ActivityFeed entries={activity} />
        <Connect catalogue={catalogue} apiUrl={API_URL} notify={notify} />
      </main>
      <footer className="mx-auto max-w-[1280px] px-6 pb-10 pt-6 text-[12px] text-label-2">
        Risklayer reads HSK Chain mainnet and records receipts there. A verdict is a check, not financial advice.{" "}
        {catalogue?.payment.hspMode === "hsp"
          ? "Payments settle through HSP."
          : catalogue?.payment.network === "sepolia"
            ? "Payments are real USDC transfers on Ethereum Sepolia, the hackathon's test token, settled by an HSP-compatible gateway we run, not by HashKey."
            : "Payments run through an HSP-compatible gateway we run, not HashKey."}
      </footer>
    </>
  );
}

/** The API runs on a free server that sleeps when idle. Say so instead of looking broken,
 * but only after a moment, so a fast load never flashes it. */
function WakeBanner({ link }: { link: "connecting" | "live" | "offline" }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 2500);
    return () => clearTimeout(t);
  }, []);
  if (link === "live" || !late) return null;
  return (
    <div role="status" className="fixed inset-x-4 top-[68px] z-40 mx-auto flex max-w-[720px] items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-[14px] shadow-card">
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-orange" />
      </span>
      <span className="text-label-2">Waking up the Risklayer API. It sleeps when nobody is using it, so the first visit can take up to a minute. This page fills in on its own.</span>
    </div>
  );
}
