import type { NextRequest } from "next/server";

import { RISKLAYER_URL } from "@/lib/api";

/**
 * Same-origin proxy to the Risklayer API. Only the read endpoints and the
 * demo agent stream are allowed through; responses are passed through
 * unbuffered so the agent's NDJSON events arrive as they happen.
 */
const ALLOWED = [/^preview\/[a-z-]+$/, /^v1\/activity$/, /^v1\/demo\/agent$/, /^catalogue$/, /^health$/];

async function proxy(req: NextRequest, parts: string[]): Promise<Response> {
  const path = parts.join("/");
  if (!ALLOWED.some(r => r.test(path))) return Response.json({ error: "not available through the dashboard" }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(`${RISKLAYER_URL}/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: {
        accept: "application/json",
        "content-type": req.headers.get("content-type") ?? "application/json",
        // Server-side only: the browser never sees the demo token.
        ...(path === "v1/demo/agent" && process.env.DEMO_AGENT_TOKEN ? { "X-Demo-Token": process.env.DEMO_AGENT_TOKEN } : {}),
      },
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return Response.json({ error: "The Risklayer API is not reachable right now." }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
