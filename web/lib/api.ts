import type { ActivityEntry, Catalogue } from "./types";

/**
 * Server components call the API directly at RISKLAYER_URL. Client
 * components go through the same-origin proxy at /api/rl/*, so the browser
 * never needs CORS or the API origin.
 */
export const RISKLAYER_URL = (process.env.RISKLAYER_URL ?? "http://localhost:4021").replace(/\/$/, "");
export const PUBLIC_API_URL = (process.env.NEXT_PUBLIC_RISKLAYER_URL ?? RISKLAYER_URL).replace(/\/$/, "");

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${RISKLAYER_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getCatalogue = () => get<Catalogue>("/catalogue");
export const getActivity = async () => (await get<{ entries: ActivityEntry[] }>("/v1/activity?limit=50"))?.entries ?? null;
