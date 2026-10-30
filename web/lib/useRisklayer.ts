"use client";

import { useEffect, useState } from "react";

import type { ActivityEntry, Catalogue, Preview } from "./types";

export type Link = "connecting" | "live" | "offline";

const api = (path: string) => `/api/rl/${path}`;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(api(path), { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Catalogue and activity, polled. The activity feed refreshes every 4 s so a
 * paid run shows up while the viewer is still looking at it. */
export function useRisklayer() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [link, setLink] = useState<Link>("connecting");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [cat, act] = await Promise.all([getJson<Catalogue>("catalogue"), getJson<{ entries: ActivityEntry[] }>("v1/activity?limit=40")]);
      if (!alive) return;
      setLink(cat ? "live" : "offline");
      if (cat) setCatalogue(cat);
      if (act) setActivity(act.entries.filter(e => e.mode === "paid"));
    };
    void load();
    const t = setInterval(load, 4_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return { catalogue, activity, link };
}

export const SAMPLE_SIZES = ["500", "60000", "900000"] as const;

/** Free previews at three sizes, so the first screen shows all three verdicts
 * computed from live HSKSwap data. */
export function useLiveSamples() {
  const [samples, setSamples] = useState<Record<string, Preview | null>>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      SAMPLE_SIZES.forEach(async size => {
        const p = await getJson<Preview>(`preview/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=${size}&maxImpactBps=100`);
        if (alive && p) setSamples(s => ({ ...s, [size]: p }));
      });
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return samples;
}
