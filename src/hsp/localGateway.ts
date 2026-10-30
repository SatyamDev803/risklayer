/**
 * HSP-compatible local gateway. NOT HashKey's gateway.
 *
 * It speaks the same wire format as HSP (AppAuth HMAC, ES256K cart JWT,
 * Cart Mandate, AP2 Payment Mandate, signed webhooks, the same payment
 * states) so the merchant and payer code paths are identical in both modes.
 *
 * With RELAYER_PRIVATE_KEY set it submits the payer's EIP-3009 authorization
 * on chain and the payment is real. Without it the authorization is fully
 * verified but not broadcast, and every record says `simulated: true`.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import { createPublicClient, createWalletClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { PAYMENT_TOKENS, type PaymentNetwork } from "../config.js";
import { abis, chainById } from "../hsk/client.js";
import { canonicalize } from "../verdict/canonical.js";
import { recoverAuthorizer, splitSignature, usdToUnits } from "./eip3009.js";
import { validateMandate, type AP2PaymentMandate } from "./mandate.js";
import type { CartMandate, PaymentRecord } from "./merchant.js";
import { hmacHex, hmacMessage, safeEqualHex, signWebhook, verifyMerchantJwt } from "./signing.js";

export interface LocalGatewayConfig {
  appKey: string;
  appSecret: string;
  merchantPublicKeyPem: string;
  /** Where payment webhooks are POSTed. A function lets callers resolve it after listen(). */
  webhookUrl: string | (() => string);
  /** Public base of this gateway, used to build payment_url. */
  publicBase: string | (() => string);
  relayerPrivateKey?: Hex;
}

interface Order {
  mandate: CartMandate;
  flowId: string;
  record: PaymentRecord;
  createdAt: string;
}

const resolve = (v: string | (() => string)) => (typeof v === "function" ? v() : v);
const ok = (data: unknown) => ({ code: 0, msg: "success", data });
const err = (res: express.Response, http: number, code: number, msg: string) => res.status(http).json({ code, msg, data: null });

export function localGateway(cfg: LocalGatewayConfig) {
  const router = express.Router();
  const orders = new Map<string, Order>();
  const flows = new Map<string, string>();
  const cartIds = new Set<string>();
  const seenNonces = new Map<string, number>();
  const relayer = cfg.relayerPrivateKey ? privateKeyToAccount(cfg.relayerPrivateKey) : null;

  const requireHmac: express.RequestHandler = (req, res, next) => {
    const appKey = req.get("X-App-Key");
    const ts = req.get("X-Timestamp") ?? "";
    const nonce = req.get("X-Nonce") ?? "";
    const signature = req.get("X-Signature") ?? "";
    if (appKey !== cfg.appKey) return err(res, 401, 10002, "unknown app key");
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return err(res, 401, 10002, "timestamp outside 5 minute window");
    const now = Date.now();
    for (const [n, at] of seenNonces) if (now - at > 300_000) seenNonces.delete(n);
    if (seenNonces.has(nonce)) return err(res, 401, 10002, "nonce reused");
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
    const body = req.method === "GET" ? undefined : canonicalize(req.body);
    const expected = hmacHex(cfg.appSecret, hmacMessage({ method: req.method, path: req.path, query, body, timestamp: ts, nonce }));
    if (!safeEqualHex(expected, signature)) return err(res, 401, 10002, "HMAC signature mismatch");
    seenNonces.set(nonce, now);
    next();
  };

  router.post("/api/v1/merchant/orders", requireHmac, (req, res) => {
    const mandate = (req.body as { cart_mandate?: CartMandate }).cart_mandate;
    const c = mandate?.contents;
    if (!mandate || !c?.id || !c.payment_request?.details?.id || !c.payment_request.method_data?.length || !c.cart_expiry || !c.merchant_name) {
      return err(res, 400, 10001, "cart_mandate.contents is missing required fields");
    }
    try {
      verifyMerchantJwt(mandate.merchant_authorization, cfg.merchantPublicKeyPem, c);
    } catch (e) {
      return err(res, 401, 10002, `merchant_authorization rejected: ${(e as Error).message}`);
    }
    const items = c.payment_request.details.display_items ?? [];
    const total = Number(c.payment_request.details.total.amount.value);
    if (items.length && Math.abs(items.reduce((s, i) => s + Number(i.amount.value), 0) - total) > 1e-9) return err(res, 400, 10001, "display_items do not sum to total");
    if (cartIds.has(c.id)) return err(res, 400, 40001, "cart_mandate_id already used");
    const paymentRequestId = c.payment_request.details.id;
    if (orders.has(paymentRequestId)) return err(res, 409, 10004, "duplicate payment_request_id");

    const flowId = randomUUID();
    const md = c.payment_request.method_data[0].data;
    cartIds.add(c.id);
    flows.set(flowId, paymentRequestId);
    orders.set(paymentRequestId, {
      mandate,
      flowId,
      createdAt: new Date().toISOString(),
      record: { payment_request_id: paymentRequestId, status: "payment-required", to_pay_address: md.pay_to, token: md.coin, chain: `eip155:${md.chain_id}`, flow_id: flowId },
    });
    res.json(ok({ payment_request_id: paymentRequestId, payment_url: `${resolve(cfg.publicBase)}/flow/${flowId}`, multi_pay: false, flow_id: flowId }));
  });

  router.get("/api/v1/merchant/payments", requireHmac, (req, res) => {
    const id = String(req.query.payment_request_id ?? (flows.get(String(req.query.flow_id ?? "")) ?? ""));
    const order = orders.get(id);
    if (!order) return err(res, 404, 10003, "payment not found");
    res.json(ok(order.record));
  });

  router.get("/api/v1/payment/flow/:flowId", (req, res) => {
    const order = orders.get(flows.get(req.params.flowId) ?? "");
    if (!order) return err(res, 404, 10003, "flow not found");
    res.json(ok({ ...order.record, cart_mandate: order.mandate }));
  });

  // Human-readable checkout page so payment_url is not a dead link.
  router.get("/flow/:flowId", (req, res) => {
    const order = orders.get(flows.get(req.params.flowId) ?? "");
    if (!order) return res.status(404).type("text/plain").send("Payment not found.");
    const c = order.mandate.contents;
    res.type("text/plain").send([
      "Risklayer local gateway (HSP-compatible, not HashKey).",
      `Merchant: ${c.merchant_name}`,
      `Item: ${c.payment_request.details.display_items[0]?.label ?? ""}`,
      `Total: ${c.payment_request.details.total.amount.value} USD in ${order.record.token}`,
      `Status: ${order.record.status}${order.record.simulated ? " (simulated, not broadcast)" : ""}`,
      order.record.tx_signature ? `Transaction: ${order.record.tx_signature}` : "",
    ].filter(Boolean).join("\n"));
  });

  router.post("/api/v1/payment/pay-mandate", async (req, res) => {
    const mandate = req.body as AP2PaymentMandate;
    const problem = validateMandate(mandate);
    if (problem) return err(res, 400, 10001, problem);
    const c = mandate.payment_mandate_contents;
    const order = orders.get(c.payment_mandate_id);
    if (!order) return err(res, 404, 10003, "no order for this payment_mandate_id");
    if (order.record.status !== "payment-required") return err(res, 400, 40001, `order is already ${order.record.status}`);
    if (Date.parse(order.mandate.contents.cart_expiry) < Date.now()) return err(res, 400, 40001, "cart mandate expired");

    const md = order.mandate.contents.payment_request.method_data[0].data;
    const network = md.network as PaymentNetwork;
    const token = PAYMENT_TOKENS[network];
    if (!token) return err(res, 400, 10001, `unsupported network ${md.network}`);
    const { authorization: auth, signature } = c.payment_response.details.payload;
    const expectedValue = usdToUnits(order.mandate.contents.payment_request.details.total.amount.value, token.decimals);
    const now = Math.floor(Date.now() / 1000);
    if (c.payment_response.details.network !== `eip155:${token.chainId}`) return err(res, 400, 10001, "authorization is for the wrong network");
    if (getAddress(auth.to) !== getAddress(md.pay_to)) return err(res, 400, 10001, "authorization pays the wrong address");
    if (BigInt(auth.value) !== expectedValue) return err(res, 400, 10001, `authorization value ${auth.value} does not equal ${expectedValue}`);
    if (Number(auth.validBefore) <= now || Number(auth.validAfter) > now) return err(res, 400, 10001, "authorization is outside its validity window");
    let signer: Address;
    try {
      signer = await recoverAuthorizer(network, auth, signature);
    } catch {
      return err(res, 400, 10001, "authorization signature is malformed");
    }
    if (getAddress(signer) !== getAddress(auth.from)) return err(res, 401, 10002, "authorization was not signed by its from address");

    order.record = { ...order.record, status: "payment-verified", payer_address: auth.from, pay_amount: order.mandate.contents.payment_request.details.total.amount.value };
    res.json(ok({ flow_id: order.flowId, payment_request_id: c.payment_mandate_id, status: "payment-verified" }));
    void settle(order, network, auth, signature);
  });

  async function settle(order: Order, network: PaymentNetwork, auth: AP2PaymentMandate["payment_mandate_contents"]["payment_response"]["details"]["payload"]["authorization"], signature: Hex) {
    const token = PAYMENT_TOKENS[network];
    if (!relayer) {
      order.record = { ...order.record, simulated: true, status_reason: "verified locally; RELAYER_PRIVATE_KEY not set, so nothing was broadcast" };
      await notify(order);
      return;
    }
    const chain = chainById(token.chainId);
    const pub = createPublicClient({ chain, transport: http(token.rpc) });
    const wallet = createWalletClient({ chain, transport: http(token.rpc), account: relayer });
    try {
      const { v, r, s } = splitSignature(signature);
      order.record = { ...order.record, status: "payment-processing" };
      const hash = await wallet.writeContract({
        address: token.address as Address,
        abi: abis.eip3009,
        functionName: "transferWithAuthorization",
        args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, v, r, s],
      });
      order.record = { ...order.record, tx_signature: hash };
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
      order.record = receipt.status === "success"
        ? { ...order.record, status: "payment-included", status_reason: `included in block ${receipt.blockNumber}` }
        : { ...order.record, status: "payment-failed", status_reason: "transferWithAuthorization reverted" };
    } catch (e) {
      order.record = { ...order.record, status: "payment-failed", status_reason: (e as Error).message.slice(0, 200) };
    }
    await notify(order);
  }

  async function notify(order: Order) {
    const c = order.mandate.contents;
    const md = c.payment_request.method_data[0].data;
    const body = JSON.stringify({
      event_type: "payment",
      payment_request_id: order.record.payment_request_id,
      request_id: order.flowId,
      cart_mandate_id: c.id,
      payer_address: order.record.payer_address,
      to_pay_address: md.pay_to,
      amount: order.record.pay_amount,
      order_amount: c.payment_request.details.total.amount.value,
      pay_amount: order.record.pay_amount,
      token: md.coin,
      token_address: md.contract_address,
      chain: `eip155:${md.chain_id}`,
      network: md.network,
      status: order.record.status,
      status_reason: order.record.status_reason,
      tx_signature: order.record.tx_signature,
      simulated: order.record.simulated ?? false,
      created_at: order.createdAt,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(resolve(cfg.webhookUrl), { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": signWebhook(cfg.appSecret, body) }, body, signal: AbortSignal.timeout(10_000) });
        if (res.ok) return;
      } catch { /* retry below */ }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    console.warn(`[local-gateway] webhook delivery failed for ${order.record.payment_request_id}; merchant can still poll /merchant/payments`);
  }

  return router;
}
