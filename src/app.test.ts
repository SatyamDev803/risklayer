/**
 * End to end in one process: seller app + HSP-compatible local gateway +
 * buyer, with market data stubbed so the test runs offline. Covers the
 * 402 → Payment Mandate → webhook → verified answer loop and its failures.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { Buyer } from "./agent/buyer.js";
import { createApp } from "./app.js";
import { localGateway } from "./hsp/localGateway.js";
import { mcpHandler } from "./mcp/server.js";
import { HspMerchant } from "./hsp/merchant.js";
import { publicKeyPem, signWebhook } from "./hsp/signing.js";
import type { ProductResult } from "./products/types.js";

const keyPem = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const appKey = "test-app";
const appSecret = randomBytes(16).toString("hex");
const seller = privateKeyToAccount(generatePrivateKey());
let base = "";
let server: Server;
let computeCalls = 0;
const logged: unknown[] = [];

const fakeCompute = async (sku: string, q: URLSearchParams): Promise<ProductResult> => {
  computeCalls++;
  const big = Number(q.get("amountIn") ?? 0) > 5000;
  return {
    verdict: sku === "trade-gate" ? (big ? "REDUCE" : "ALLOW") : "INFO",
    reasons: [big ? "Price impact is 1206 bps, above your 100 bps limit." : "Within limits."],
    data: { priceImpactBps: big ? 1206 : 11, recommendedAmountIn: big ? "4300" : null, pool: { address: "0xpool", feeTier: 3000 } },
    sources: [{ type: "hskswap-pool", ref: "0xpool", blockNumber: 29_525_243 }],
    blockNumber: 29_525_243,
  };
};

beforeAll(async () => {
  const merchant = new HspMerchant({ baseUrl: "", appKey, appSecret, merchantPrivateKeyPem: keyPem, merchantName: "Risklayer" });
  const app = createApp({
    merchant,
    hspMode: "local",
    network: "hashkey",
    payTo: seller.address,
    merchantPublicKeyPem: publicKeyPem(keyPem),
    webhookSecret: appSecret,
    payMandateUrl: () => `${base}/hsp-local/api/v1/payment/pay-mandate`,
    receipts: null, allowSimulatedPayments: true,
    compute: fakeCompute,
    demoAgent: { account: privateKeyToAccount(generatePrivateKey()), seller: () => base, maxUsdPerCall: 1, currentBlock: async () => 29_525_243 },
    log: e => logged.push(e),
    mounts: [{ path: "/mcp", handler: mcpHandler("http://seller.test", fakeCompute) }, { path: "/hsp-local", handler: localGateway({ appKey, appSecret, merchantPublicKeyPem: publicKeyPem(keyPem), webhookUrl: () => `${base}/v1/hsp/webhook`, publicBase: () => `${base}/hsp-local` }) }],
  });
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (merchant.cfg as { baseUrl: string }).baseUrl = `${base}/hsp-local`;
});

afterAll(() => server?.close());

const buyer = () => new Buyer({ seller: base, account: privateKeyToAccount(generatePrivateKey()), maxUsdPerCall: 1 });

describe("paid answer loop", () => {
  it("rejects a malformed question before asking for money", async () => {
    const res = await fetch(`${base}/v1/trade-gate?tokenIn=USDT&tokenOut=USDT&amountIn=1`);
    expect(res.status).toBe(400);
  });

  it("pays through the gateway and returns a verified, request-bound answer", async () => {
    const r = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", maxImpactBps: "100" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.verdict).toBe("REDUCE");
    expect(r.answer.requestId).toBe(r.requestId);
    expect(r.answer.payment.simulated).toBe(true);
    expect(r.answer.payment.label).toMatch(/not HashKey/);
  });

  it("catches a seller that changes the verdict after sealing it", async () => {
    const r = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", maxImpactBps: "100", corrupt: "1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("verify");
    expect(r.answer?.verdict).toBe("ALLOW");
    expect(r.problems.join()).toMatch(/hash mismatch/);
  });

  it("does not release an answer before payment", async () => {
    const first = await fetch(`${base}/v1/chain-status`);
    expect(first.status).toBe(402);
    const id = first.headers.get("X-Risklayer-Request")!;
    const again = await fetch(`${base}/v1/chain-status`, { headers: { "X-Risklayer-Request": id } });
    expect(again.status).toBe(402);
  });

  it("refuses to reuse a paid request id for another question", async () => {
    const r = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "300", maxImpactBps: "100" });
    expect(r.ok).toBe(true);
    const other = await fetch(`${base}/v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=900000&maxImpactBps=100`, { headers: { "X-Risklayer-Request": r.requestId! } });
    expect(other.status).toBe(409);
  });

  it("computes once per payment and serves the same answer on repeat", async () => {
    const r = await buyer().ask("pool-depth", { tokenA: "USDT", tokenB: "WHSK" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = computeCalls;
    const again = await fetch(`${base}/v1/pool-depth?tokenA=USDT&tokenB=WHSK`, { headers: { "X-Risklayer-Request": r.requestId } });
    expect(((await again.json()) as { proof: { resultHash: string } }).proof.resultHash).toBe(r.answer.proof.resultHash);
    expect(computeCalls).toBe(before);
  });

  it("rejects a terms change: a buyer with a different expected payee will not sign", async () => {
    const b = buyer();
    const cat = await b.discover();
    cat.payment.payTo = privateKeyToAccount(generatePrivateKey()).address;
    const r = await b.ask("chain-status", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("terms");
  });

  it("rejects webhooks without a valid signature and ignores replays", async () => {
    const body = JSON.stringify({ payment_request_id: "nope", status: "payment-finalized" });
    const bad = await fetch(`${base}/v1/hsp/webhook`, { method: "POST", body, headers: { "X-Signature": signWebhook("wrong", body) } });
    expect(bad.status).toBe(401);
    const good = signWebhook(appSecret, body);
    expect((await fetch(`${base}/v1/hsp/webhook`, { method: "POST", body, headers: { "X-Signature": good } })).status).toBe(200);
    expect((await fetch(`${base}/v1/hsp/webhook`, { method: "POST", body, headers: { "X-Signature": good } })).status).toBe(200);
  });

  it("rejects merchant API calls with a bad HMAC", async () => {
    const res = await fetch(`${base}/hsp-local/api/v1/merchant/payments?payment_request_id=x`, { headers: { "X-App-Key": appKey, "X-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Nonce": "abc123abc123", "X-Signature": "00" } });
    expect(res.status).toBe(401);
  });

  it("logs every paid answer", () => {
    expect(logged.some(e => (e as { mode: string }).mode === "paid")).toBe(true);
  });
});

describe("MCP surface", () => {
  const rpc = async (method: string, params: unknown, id = 1) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const text = await res.text();
    const json = text.startsWith("{") ? text : text.split("\n").find(l => l.startsWith("data: "))!.slice(6);
    return JSON.parse(json) as { result: { tools?: { name: string }[]; content?: { text: string }[] } };
  };

  it("lists the tools and answers trade_gate with the free preview", async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const tools = await rpc("tools/list", {}, 2);
    expect(tools.result.tools!.map(t => t.name)).toContain("trade_gate");
    const call = await rpc("tools/call", { name: "trade_gate", arguments: { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000" } }, 3);
    const text = call.result.content![0].text;
    expect(text).toMatch(/^Verdict: REDUCE/);
    expect(text).toContain("http://seller.test/v1/trade-gate?");
  });
});

describe("demo agent stream", () => {
  const run = async (body: Record<string, unknown>) => {
    const res = await fetch(`${base}/v1/demo/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, events: (await res.text()).split("\n").filter(Boolean).map(l => JSON.parse(l) as { type: string; outcome?: string; verdict?: string; stage?: string }) };
  };

  it("streams the agent refusing a corrupted answer", async () => {
    const { status, events } = await run({ tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", corrupt: true });
    expect(status).toBe(200);
    expect(events.find(e => e.type === "rejected")?.stage).toBe("verify");
    expect(events.at(-1)).toMatchObject({ type: "done", outcome: "refused" });
  });

  it("validates the task before running", async () => {
    expect((await run({ tokenIn: "USDT", tokenOut: "WHSK", amountIn: "-1" })).status).toBe(400);
  });
});

describe("hardening", () => {
  it("does not release answers for simulated payments unless allowed", async () => {
    const merchant = new HspMerchant({ baseUrl: "", appKey, appSecret, merchantPrivateKeyPem: keyPem, merchantName: "Risklayer" });
    let strictBase = "";
    const strict = createApp({
      merchant, hspMode: "local", network: "hashkey", payTo: seller.address, merchantPublicKeyPem: publicKeyPem(keyPem), webhookSecret: appSecret,
      payMandateUrl: () => `${strictBase}/hsp-local/api/v1/payment/pay-mandate`, receipts: null, compute: fakeCompute, log: () => {},
      mounts: [{ path: "/hsp-local", handler: localGateway({ appKey, appSecret, merchantPublicKeyPem: publicKeyPem(keyPem), webhookUrl: () => `${strictBase}/v1/hsp/webhook`, publicBase: () => `${strictBase}/hsp-local` }) }],
    });
    const s = strict.listen(0);
    await new Promise(r => s.once("listening", r));
    strictBase = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    (merchant.cfg as { baseUrl: string }).baseUrl = `${strictBase}/hsp-local`;
    try {
      const b = new Buyer({ seller: strictBase, account: privateKeyToAccount(generatePrivateKey()), maxUsdPerCall: 1 });
      const first = await fetch(`${strictBase}/v1/chain-status`);
      const { buildMandate, submitMandate } = await import("./hsp/payer.js");
      const challenge = (await first.json()) as Parameters<typeof buildMandate>[1] & { requestId: string };
      await b.discover();
      await submitMandate(challenge.hsp.payMandateUrl, await buildMandate(privateKeyToAccount(generatePrivateKey()), challenge, "hashkey"));
      await new Promise(r => setTimeout(r, 300));
      const again = await fetch(`${strictBase}/v1/chain-status`, { headers: { "X-Risklayer-Request": challenge.requestId } });
      expect(again.status).toBe(402);
    } finally {
      s.close();
    }
  });

  it("keeps request ids out of the public activity feed and status endpoint", async () => {
    const r = await buyer().ask("chain-status", {});
    expect(r.ok).toBe(true);
    const logged = logged_entries();
    expect(logged.some(e => e.requestId === r.requestId)).toBe(false);
    const status = (await (await fetch(`${base}/v1/requests/${r.requestId}`)).json()) as Record<string, unknown>;
    expect(status.answer).toBeUndefined();
    expect(status.answered).toBe(true);
  });
});

const logged_entries = () => logged as { requestId?: string }[];
