/**
 * Risklayer seller: the "receiving agent" in HSP terms.
 *
 * Flow per paid question:
 *   GET /v1/<sku>?...                → validate (400 is free) → HSP order → 402 + signed Cart Mandate
 *   buyer signs an AP2 Payment Mandate and submits it to the HSP gateway
 *   gateway webhook → POST /v1/hsp/webhook (HMAC verified, idempotent)
 *   GET /v1/<sku>?... + X-Risklayer-Request → run SKU → seal → receipt on HSK → 200
 *
 * The answer is bound to the request id, so it cannot be replayed for a
 * different question, and it is computed once per payment.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import type { Address, Hex, LocalAccount } from "viem";

import { runAgent, type AgentEvent } from "./agent/runAgent.js";

import { readActivity, recordActivity, type ActivityEntry } from "./activity.js";
import { SKUS, skuById } from "./catalogue.js";
import { PAYMENT_TOKENS, type HspMode, type PaymentNetwork } from "./config.js";
import { buildCartContents, HspError, PAID_STATES, type CartMandate, type HspMerchant, type PaymentRecord } from "./hsp/merchant.js";
import { verifyWebhook } from "./hsp/signing.js";
import { boundQuery, computeSku, runSku, validateQuery, type Compute } from "./products/runSku.js";
import { parseTradeGateQuery } from "./products/tradeGate.js";
import type { Envelope } from "./verdict/envelope.js";
import { canonicalize } from "./verdict/canonical.js";

export interface AppDeps {
  merchant: HspMerchant;
  hspMode: HspMode;
  network: PaymentNetwork;
  payTo: Address;
  merchantPublicKeyPem: string;
  /** app_secret: verifies gateway webhooks. */
  webhookSecret: string;
  /** Where buyers submit Payment Mandates. A function lets callers resolve it after listen(). */
  payMandateUrl: string | (() => string);
  receipts: { address: Address; record(paymentRequestId: string, env: Envelope, payer: Address): Promise<Hex> } | null;
  compute?: Compute;
  /** Extra routers mounted before the paid routes (local gateway, MCP). */
  mounts?: { path: string; handler: express.RequestHandler | express.Router }[];
  devBypass?: boolean;
  /** Treat payments the local gateway verified but did not broadcast as paid.
   * Off unless explicitly enabled: a public server must not answer for free. */
  allowSimulatedPayments?: boolean;
  /** Enables POST /v1/demo/agent: the dashboard watches the trading agent
   * buy checks from this server. It never sends a swap. */
  demoAgent?: { account: LocalAccount; seller: () => string; maxUsdPerCall: number; currentBlock?: () => Promise<number>; token?: string; maxRunsPerHour?: number };
  log?: (entry: ActivityEntry) => void;
}

interface PaidRequest {
  requestId: string;
  sku: string;
  rawQuery: string;
  query: Record<string, string>;
  priceUsd: string;
  paymentRequestId: string;
  cartMandateId: string;
  paymentUrl: string;
  cartMandate: CartMandate;
  createdAt: string;
  payment: { status: string; simulated: boolean; payer?: Address; tx?: string; reason?: string };
  answer?: Record<string, unknown>;
  fulfilling?: Promise<Record<string, unknown>>;
}

export const REQUEST_HEADER = "X-Risklayer-Request";
const STATE_ORDER = ["payment-required", "payment-submitted", "payment-verified", "payment-processing", "payment-included", "payment-safe", "payment-finalized"];

export function createApp(deps: AppDeps) {
  const compute = deps.compute ?? computeSku;
  const log = deps.log ?? recordActivity;
  const requests = new Map<string, PaidRequest>();
  const byPaymentId = new Map<string, string>();
  const token = PAYMENT_TOKENS[deps.network];
  const modeLabel = deps.hspMode === "hsp" ? "HashKey Settlement Protocol" : "HSP-compatible local gateway (not HashKey)";

  const payMandateUrl = () => (typeof deps.payMandateUrl === "function" ? deps.payMandateUrl() : deps.payMandateUrl);

  const isPaid = (r: PaidRequest) =>
    PAID_STATES.has(r.payment.status) || (deps.hspMode === "local" && !!deps.allowSimulatedPayments && r.payment.simulated && r.payment.status === "payment-verified");
  /** Public logs show a hash of the request id: the id itself lets its holder fetch the paid answer. */
  const publicRef = (requestId: string) => createHash("sha256").update(requestId).digest("hex").slice(0, 12);

  /** Apply a payment update without ever moving backwards (webhooks retry and race polls). */
  function applyPayment(r: PaidRequest, rec: Partial<PaymentRecord> & { status: string; simulated?: boolean }) {
    if (r.payment.status === "payment-failed") return;
    if (rec.status === "payment-failed" ? isPaid(r) : STATE_ORDER.indexOf(rec.status) < STATE_ORDER.indexOf(r.payment.status)) return;
    r.payment = {
      status: rec.status,
      simulated: rec.simulated ?? r.payment.simulated,
      payer: (rec.payer_address as Address | undefined) ?? r.payment.payer,
      tx: rec.tx_signature ?? r.payment.tx,
      reason: rec.status_reason ?? r.payment.reason,
    };
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ exposedHeaders: [REQUEST_HEADER] }));
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Raw body: the webhook HMAC is over the exact bytes received.
  app.post("/v1/hsp/webhook", express.raw({ type: "*/*", limit: "64kb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    try {
      verifyWebhook(deps.webhookSecret, raw, req.get("X-Signature"));
    } catch (e) {
      return res.status(401).json({ code: 10002, msg: (e as Error).message });
    }
    const event = JSON.parse(raw) as PaymentRecord & { simulated?: boolean };
    const r = requests.get(byPaymentId.get(event.payment_request_id) ?? "");
    if (r) applyPayment(r, event);
    res.json({ code: 0 });
  });

  app.use(express.json({ limit: "64kb" }));
  for (const m of deps.mounts ?? []) app.use(m.path, m.handler);

  /* ---------------- free surface ---------------- */

  app.get("/health", (_req, res) => res.json({ ok: true, hspMode: deps.hspMode, payments: modeLabel, network: deps.network, receipts: deps.receipts?.address ?? null }));

  app.get("/catalogue", (_req, res) =>
    res.json({
      name: "Risklayer",
      tagline: "The check an AI agent runs before it moves money on HSK Chain.",
      marketData: { chainId: 177, network: "HSK Chain mainnet" },
      payment: {
        protocol: modeLabel,
        hspMode: deps.hspMode,
        network: token.network,
        chainId: token.chainId,
        token: { symbol: token.coin, address: token.address, decimals: token.decimals },
        payTo: deps.payTo,
        payMandateUrl: payMandateUrl(),
      },
      merchant: { name: deps.merchant.cfg.merchantName, publicKeyPem: deps.merchantPublicKeyPem },
      receipts: deps.receipts ? { chainId: 177, address: deps.receipts.address } : null,
      skus: SKUS.map(s => ({ ...s, path: `/v1/${s.id}`, previewPath: `/preview/${s.id}` })),
      verdicts: { ALLOW: "go ahead", REDUCE: "go ahead at the suggested smaller size", BLOCK: "do not proceed", HOLD: "get more evidence first", INFO: "evidence only" },
    }),
  );

  app.get("/v1/activity", (req, res) => {
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(req.query.limit ?? 50)) || 50));
    res.json({ entries: readActivity(limit) });
  });

  app.get("/v1/requests/:id", (req, res) => {
    const r = requests.get(req.params.id);
    if (!r) return res.status(404).json({ error: "unknown request" });
    // Status only. The answer is served by GET /v1/:sku with the request header, bound to the same question.
    res.json({ requestId: r.requestId, sku: r.sku, payment: { status: r.payment.status, simulated: r.payment.simulated }, paid: isPaid(r), answered: !!r.answer });
  });

  /** Free preview: the verdict and reasons, without evidence, proof or receipt. */
  app.get("/preview/:sku", async (req, res) => {
    const sku = req.params.sku;
    const q = new URL(req.originalUrl, "http://x").searchParams;
    q.delete("corrupt");
    try {
      validateQuery(sku, q);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    try {
      const env = await runSku(sku, q, `preview-${randomUUID()}`, compute);
      log({ ts: new Date().toISOString(), sku, query: env.query, mode: "preview", verdict: env.verdict, reasons: env.reasons, blockNumber: env.proof.blockNumber, ok: true });
      res.json({ preview: true, sku, verdict: env.verdict, reasons: env.reasons, blockNumber: env.proof.blockNumber, note: `Full evidence, the result hash and an on-chain receipt cost ${skuById(sku)!.priceUsd} USD at /v1/${sku}.` });
    } catch (e) {
      res.status(502).json({ error: `could not read HSK Chain: ${(e as Error).message}` });
    }
  });

  /* ---------------- paid surface ---------------- */

  const paid = async (req: express.Request, res: express.Response) => {
    const sku = req.params.sku as string;
    const meta = skuById(sku);
    if (!meta) return res.status(404).json({ error: `unknown sku '${sku}'`, catalogue: "/catalogue" });
    const rawQuery = new URL(req.originalUrl, "http://x").searchParams;
    try {
      validateQuery(sku, rawQuery);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    const query = boundQuery(rawQuery);

    if (deps.devBypass && req.path.startsWith("/dev/")) {
      const env = await runSku(sku, rawQuery, `dev-${randomUUID()}`, compute);
      return res.json({ ...env, payment: { mode: "dev-bypass", note: "unpaid local mirror" } });
    }

    const requestId = req.get(REQUEST_HEADER);
    if (!requestId) return challenge(res, sku, meta.priceUsd, rawQuery, query);

    const r = requests.get(requestId);
    if (!r) return res.status(404).json({ error: "unknown request id; ask again without the header to get a new payment request" });
    if (r.sku !== sku || canonicalize(r.query) !== canonicalize(query)) return res.status(409).json({ error: "this request id was paid for a different question" });
    if (r.answer) return res.json(r.answer);

    if (!isPaid(r)) {
      try {
        const rec = await deps.merchant.getPayment(r.paymentRequestId);
        applyPayment(r, rec as PaymentRecord & { simulated?: boolean });
      } catch { /* gateway lookup is a fallback to the webhook */ }
    }
    if (!isPaid(r)) {
      res.set(REQUEST_HEADER, r.requestId);
      return res.status(402).json({ ...challengeBody(r), payment: r.payment });
    }

    try {
      r.fulfilling ??= fulfil(r);
      res.json(await r.fulfilling);
    } catch (e) {
      r.fulfilling = undefined;
      log({ ts: new Date().toISOString(), requestId: publicRef(r.requestId), sku, query, mode: "paid", ok: false, error: (e as Error).message });
      res.status(502).json({ error: `paid, but the answer could not be computed: ${(e as Error).message}. Retry with the same request id; you will not be charged again.` });
    }
  };

  async function challenge(res: express.Response, sku: string, priceUsd: string, rawQuery: URLSearchParams, query: Record<string, string>) {
    const requestId = randomUUID();
    const paymentRequestId = `RL-PR-${requestId}`;
    const cartMandateId = `RL-CART-${requestId}`;
    const contents = buildCartContents({
      cartMandateId,
      paymentRequestId,
      label: `Risklayer ${sku}`,
      priceUsd,
      payTo: deps.payTo,
      network: deps.network,
      merchantName: deps.merchant.cfg.merchantName,
      ttlSec: 2 * 3600,
    });
    const cartMandate = deps.merchant.signCart(contents);
    let order: { payment_request_id: string; payment_url: string };
    try {
      order = await deps.merchant.createOrder(cartMandate);
    } catch (e) {
      const msg = e instanceof HspError ? e.message : (e as Error).message;
      return res.status(503).json({ error: `payment gateway unavailable, nothing was charged: ${msg}` });
    }
    const r: PaidRequest = {
      requestId, sku, rawQuery: rawQuery.toString(), query, priceUsd, paymentRequestId, cartMandateId,
      paymentUrl: order.payment_url, cartMandate, createdAt: new Date().toISOString(),
      payment: { status: "payment-required", simulated: false },
    };
    requests.set(requestId, r);
    byPaymentId.set(paymentRequestId, requestId);
    res.set(REQUEST_HEADER, requestId);
    res.status(402).json(challengeBody(r));
  }

  function challengeBody(r: PaidRequest) {
    return {
      error: "payment_required",
      message: `This answer costs ${r.priceUsd} USD in ${token.coin}. Pay through ${modeLabel}, then repeat the request with the ${REQUEST_HEADER} header.`,
      requestId: r.requestId,
      sku: r.sku,
      query: r.query,
      priceUsd: r.priceUsd,
      hsp: {
        mode: deps.hspMode,
        label: modeLabel,
        paymentRequestId: r.paymentRequestId,
        cartMandateId: r.cartMandateId,
        paymentUrl: r.paymentUrl,
        payMandateUrl: payMandateUrl(),
        cartMandate: r.cartMandate,
      },
      retry: { header: REQUEST_HEADER, value: r.requestId },
    };
  }

  async function fulfil(r: PaidRequest): Promise<Record<string, unknown>> {
    const env = await runSku(r.sku, new URLSearchParams(r.rawQuery), r.requestId, compute);
    let receiptTx: Hex | undefined;
    let receiptError: string | undefined;
    // Receipts record real payments only; a simulated payment never reaches the chain.
    if (deps.receipts && r.payment.payer && !r.payment.simulated) {
      try {
        receiptTx = await deps.receipts.record(r.paymentRequestId, env, r.payment.payer);
      } catch (e) {
        receiptError = (e as Error).message.split("\n")[0];
      }
    }
    const payment = {
      mode: deps.hspMode,
      label: modeLabel,
      status: r.payment.status,
      simulated: r.payment.simulated,
      payer: r.payment.payer,
      tx: r.payment.tx,
      network: token.network,
      chainId: token.chainId,
      amountUsd: r.priceUsd,
      paymentRequestId: r.paymentRequestId,
    };
    const answer = {
      ...env,
      payment,
      receipt: deps.receipts ? { chainId: 177, contract: deps.receipts.address, tx: receiptTx ?? null, error: receiptError } : null,
    };
    r.answer = answer;
    log({
      ts: new Date().toISOString(), requestId: publicRef(r.requestId), sku: r.sku, query: r.query, mode: "paid",
      verdict: env.verdict, reasons: env.reasons, resultHash: env.proof.resultHash, blockNumber: env.proof.blockNumber,
      payment: { mode: deps.hspMode, status: r.payment.status, simulated: r.payment.simulated, payer: r.payment.payer, tx: r.payment.tx, network: token.network, amountUsd: r.priceUsd },
      receiptTx, ok: true,
    });
    return answer;
  }

  /* ---------------- demo agent (dashboard) ---------------- */

  let agentBusy = false;
  const agentRuns: number[] = [];
  app.post("/v1/demo/agent", async (req, res) => {
    if (!deps.demoAgent) return res.status(404).json({ error: "the demo agent is not enabled on this server" });
    const token = deps.demoAgent.token;
    const given = req.get("X-Demo-Token") ?? "";
    if (token && !(given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token)))) {
      return res.status(401).json({ error: "This server needs a demo token to run the agent." });
    }
    // Each run can spend real USDC: cap runs per hour across all callers.
    const hourAgo = Date.now() - 3_600_000;
    while (agentRuns.length && agentRuns[0] < hourAgo) agentRuns.shift();
    if (agentRuns.length >= (deps.demoAgent.maxRunsPerHour ?? 30)) return res.status(429).json({ error: "The demo agent has reached its hourly limit. Try again later." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const q = new URLSearchParams({
      tokenIn: String(body.tokenIn ?? "USDT"),
      tokenOut: String(body.tokenOut ?? "WHSK"),
      amountIn: String(body.amountIn ?? ""),
      maxImpactBps: String(body.maxImpactBps ?? 100),
    });
    try {
      parseTradeGateQuery(q);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    if (agentBusy) return res.status(429).json({ error: "The agent is already running. Try again in a few seconds." });
    agentBusy = true;
    agentRuns.push(Date.now());
    res.status(200).set({ "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const emit = (e: AgentEvent) => res.write(`${JSON.stringify(e)}\n`);
    try {
      await runAgent(
        { tokenIn: q.get("tokenIn")!, tokenOut: q.get("tokenOut")!, amountIn: q.get("amountIn")!, maxImpactBps: q.get("maxImpactBps")!, slippageBps: 50, corrupt: body.corrupt === true, checkPayee: body.checkPayee === true, execute: false },
        { seller: deps.demoAgent.seller(), account: deps.demoAgent.account, maxUsdPerCall: deps.demoAgent.maxUsdPerCall, canSwap: false, currentBlock: deps.demoAgent.currentBlock },
        emit,
      );
    } catch (e) {
      emit({ type: "done", outcome: "stopped", summary: `The agent stopped: ${(e as Error).message}` });
    } finally {
      agentBusy = false;
      res.end();
    }
  });

  app.get("/v1/:sku", paid);
  if (deps.devBypass) app.get("/dev/v1/:sku", paid);

  return app;
}
