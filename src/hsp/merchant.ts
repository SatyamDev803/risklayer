/**
 * Merchant side of HSP: build a Cart Mandate for one SKU purchase, sign it,
 * create the order, and look up payment status. Talks to HashKey's Merchant
 * API in `hsp` mode or to the HSP-compatible local gateway in `local` mode;
 * the wire format is identical in both.
 */
import { PAYMENT_TOKENS, type PaymentNetwork } from "../config.js";
import { canonicalize } from "../verdict/canonical.js";
import { signedHeaders, signMerchantJwt } from "./signing.js";

export const X402_METHOD = "https://www.x402.org/";

export interface CartContents {
  id: string;
  user_cart_confirmation_required: boolean;
  payment_request: {
    method_data: {
      supported_methods: string;
      data: { x402Version: 2; network: string; chain_id: number; contract_address: string; pay_to: string; coin: string };
    }[];
    details: {
      id: string;
      display_items: { label: string; amount: { currency: "USD"; value: string } }[];
      total: { label: string; amount: { currency: "USD"; value: string } };
    };
  };
  cart_expiry: string;
  merchant_name: string;
}

export interface CartMandate {
  contents: CartContents;
  merchant_authorization: string;
}

export interface CartInput {
  cartMandateId: string;
  paymentRequestId: string;
  label: string;
  priceUsd: string;
  payTo: string;
  network: PaymentNetwork;
  merchantName: string;
  ttlSec: number;
}

export function buildCartContents(i: CartInput): CartContents {
  const token = PAYMENT_TOKENS[i.network];
  return {
    id: i.cartMandateId,
    // Agents pay without a human in the loop; the buyer's own policy is the confirmation.
    user_cart_confirmation_required: false,
    payment_request: {
      method_data: [{
        supported_methods: X402_METHOD,
        data: { x402Version: 2, network: token.network, chain_id: token.chainId, contract_address: token.address, pay_to: i.payTo, coin: token.coin },
      }],
      details: {
        id: i.paymentRequestId,
        display_items: [{ label: i.label, amount: { currency: "USD", value: i.priceUsd } }],
        total: { label: "Total", amount: { currency: "USD", value: i.priceUsd } },
      },
    },
    cart_expiry: new Date(Date.now() + i.ttlSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    merchant_name: i.merchantName,
  };
}

export interface PaymentRecord {
  payment_request_id: string;
  status: string;
  payer_address?: string;
  to_pay_address?: string;
  tx_signature?: string;
  pay_amount?: string;
  token?: string;
  chain?: string;
  flow_id?: string;
  status_reason?: string;
  /** Set only by the local gateway when it verified but did not broadcast. */
  simulated?: boolean;
}

export interface MerchantConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  merchantPrivateKeyPem: string;
  merchantName: string;
}

export class HspError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

export class HspMerchant {
  constructor(readonly cfg: MerchantConfig) {}

  signCart(contents: CartContents): CartMandate {
    const ttl = Math.max(60, Math.floor((Date.parse(contents.cart_expiry) - Date.now()) / 1000));
    return { contents, merchant_authorization: signMerchantJwt(this.cfg.merchantPrivateKeyPem, this.cfg.merchantName, contents, ttl) };
  }

  async createOrder(mandate: CartMandate): Promise<{ payment_request_id: string; payment_url: string; flow_id?: string }> {
    return this.call("POST", "/api/v1/merchant/orders", undefined, { cart_mandate: mandate });
  }

  async getPayment(paymentRequestId: string): Promise<PaymentRecord> {
    return this.call("GET", "/api/v1/merchant/payments", `payment_request_id=${encodeURIComponent(paymentRequestId)}`);
  }

  private async call<T>(method: "GET" | "POST", path: string, query?: string, body?: unknown): Promise<T> {
    const raw = body === undefined ? undefined : canonicalize(body);
    const headers = signedHeaders(this.cfg.appKey, this.cfg.appSecret, { method, path, query, body: raw });
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: { ...headers, ...(raw ? { "Content-Type": "application/json" } : {}) },
      body: raw,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let envelope: { code?: number; msg?: string; data?: T };
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new HspError(`HSP ${method} ${path} returned non-JSON (HTTP ${res.status})`, res.status);
    }
    if (!res.ok || envelope.code !== 0) throw new HspError(`HSP ${method} ${path} failed: ${envelope.msg ?? res.statusText}`, res.status, envelope.code);
    return envelope.data as T;
  }
}

/** Payment states that mean the transfer is on chain (or, in local
 * simulated mode, verified). Fulfilment waits for one of these. */
export const PAID_STATES = new Set(["payment-included", "payment-safe", "payment-finalized"]);
