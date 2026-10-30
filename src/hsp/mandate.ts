/**
 * AP2 Payment Mandate, the payer-side message. The outer shape follows
 * `AP2PaymentMandate` in HashKey's Go SDK (types/ap2.go). HSP has not
 * published the body of `payment_response.details`; we send the x402 v2
 * "exact" EVM payload (EIP-3009 authorization + signature) because HSP
 * describes its rail as AP2 mandates over x402. Confirm with HashKey before
 * pointing this at the production gateway.
 */
import type { Hex } from "viem";

import type { Authorization } from "./eip3009.js";

export interface PaymentItem {
  label: string;
  amount: { currency: string; value: string };
}

export interface X402ExactDetails {
  x402Version: 2;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Authorization };
}

export interface AP2PaymentMandate {
  payment_mandate_contents: {
    payment_mandate_id: string;
    payment_details_id: string;
    payment_details_total: PaymentItem;
    payment_response: { request_id: string; method_name: string; details: X402ExactDetails };
    merchant_agent: string;
    timestamp: string;
  };
  user_authorization?: string;
}

export function validateMandate(m: AP2PaymentMandate): string | undefined {
  const c = m?.payment_mandate_contents;
  if (!c?.payment_mandate_id) return "payment_mandate_id is required";
  if (!c.payment_details_id) return "payment_details_id is required";
  if (!c.merchant_agent) return "merchant_agent is required";
  if (!c.payment_details_total?.label) return "payment_details_total is required";
  if (!c.payment_response?.request_id) return "payment_response is required";
  const d = c.payment_response.details;
  if (d?.scheme !== "exact" || !d.payload?.signature || !d.payload.authorization) return "payment_response.details must be an x402 exact payload";
  return undefined;
}
