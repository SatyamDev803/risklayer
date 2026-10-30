"use client";

import { useCallback, useRef, useState } from "react";

import { ActivityFeed } from "@/components/activityFeed";
import { CheckConsole } from "@/components/checkConsole";
import { Connect } from "@/components/connect";
import { HowItWorks } from "@/components/howItWorks";
import { Overview } from "@/components/overview";
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
        <Overview />
        <CheckConsole notify={notify} />
        <HowItWorks />
        <ActivityFeed entries={activity} />
        <Connect catalogue={catalogue} apiUrl={API_URL} notify={notify} />
      </main>
      <footer className="mx-auto max-w-[1280px] px-6 pb-10 pt-6 text-[12px] text-label-2">
        Risklayer reads HSK Chain mainnet. A verdict is a check, not financial advice. Payments on this server run through {catalogue?.payment.hspMode === "hsp" ? "HSP" : "an HSP-compatible local gateway, not HashKey"}.
      </footer>
    </>
  );
}
