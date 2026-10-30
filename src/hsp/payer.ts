/**
 * The paying agent's side of HSP: check the seller's signed terms, sign an
 * EIP-3009 authorization for exactly that amount, wrap it in an AP2 Payment
 * Mandate and submit it to the gateway.
 */
import { randomUUID } from "node:crypto";
import { getAddress, type Address, type LocalAccount } from "viem";

import { PAYMENT_TOKENS, type PaymentNetwork } from "../config.js";
import { nonceFor, signAuthorization, usdToUnits, type Authorization } from "./eip3009.js";
import type { AP2PaymentMandate } from "./mandate.js";
import { X402_METHOD, type CartMandate } from "./merchant.js";
import { verifyMerchantJwt } from "./signing.js";

export interface PaymentChallenge {
  requestId: string;
  sku: string;
  priceUsd: string;
  hsp: {
    mode: "hsp" | "local";
    label: string;
    paymentRequestId: string;
    paymentUrl: string;
    payMandateUrl: string;
    cartMandate: CartMandate;
  };
}

export interface SpendPolicy {
  maxUsdPerCall: number;
  /** Payee the buyer expects (from the catalogue it trusts). */
  expectedPayTo: Address;
  merchantPublicKeyPem: string;
  network: PaymentNetwork;
}

/** Everything the buyer checks before it signs anything. */
export function checkChallenge(ch: PaymentChallenge, policy: SpendPolicy): string[] {
  const problems: string[] = [];
  const c = ch.hsp.cartMandate.contents;
  try {
    verifyMerchantJwt(ch.hsp.cartMandate.merchant_authorization, policy.merchantPublicKeyPem, c);
  } catch (e) {
    problems.push(`seller terms are not signed by the published merchant key: ${(e as Error).message}`);
  }
  const md = c.payment_request.method_data[0];
  const token = PAYMENT_TOKENS[policy.network];
  if (md?.supported_methods !== X402_METHOD) problems.push("unsupported payment method");
  if (md?.data.chain_id !== token.chainId || md.data.contract_address.toLowerCase() !== token.address.toLowerCase()) problems.push(`terms ask for ${md?.data.coin} on chain ${md?.data.chain_id}, expected ${token.coin} on ${token.chainId}`);
  if (md && getAddress(md.data.pay_to) !== getAddress(policy.expectedPayTo)) problems.push(`terms pay ${md.data.pay_to}, not the published payee ${policy.expectedPayTo}`);
  const total = c.payment_request.details.total.amount.value;
  if (total !== ch.priceUsd) problems.push(`terms total ${total} differs from quoted price ${ch.priceUsd}`);
  if (Number(total) > policy.maxUsdPerCall) problems.push(`price ${total} USD is above the spend limit of ${policy.maxUsdPerCall} USD`);
  if (c.payment_request.details.id !== ch.hsp.paymentRequestId) problems.push("payment_request_id in terms does not match the challenge");
  return problems;
}

export async function buildMandate(account: LocalAccount, ch: PaymentChallenge, network: PaymentNetwork): Promise<AP2PaymentMandate> {
  const c = ch.hsp.cartMandate.contents;
  const md = c.payment_request.method_data[0].data;
  const token = PAYMENT_TOKENS[network];
  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from: account.address,
    to: getAddress(md.pay_to),
    value: usdToUnits(c.payment_request.details.total.amount.value, token.decimals).toString(),
    validAfter: String(now - 5),
    validBefore: String(now + 3600),
    nonce: nonceFor(ch.hsp.paymentRequestId),
  };
  const signature = await signAuthorization(account, network, authorization);
  return {
    payment_mandate_contents: {
      payment_mandate_id: ch.hsp.paymentRequestId,
      payment_details_id: randomUUID(),
      payment_details_total: c.payment_request.details.total,
      payment_response: {
        request_id: randomUUID(),
        method_name: X402_METHOD,
        details: { x402Version: 2, scheme: "exact", network: `eip155:${token.chainId}`, payload: { signature, authorization } },
      },
      merchant_agent: c.merchant_name,
      timestamp: new Date().toISOString(),
    },
    user_authorization: signature,
  };
}

export async function submitMandate(url: string, mandate: AP2PaymentMandate): Promise<{ status: string; flow_id?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mandate), signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: { status: string; flow_id?: string } };
  if (!res.ok || body.code !== 0 || !body.data) throw new Error(`pay-mandate rejected: ${body.msg ?? `HTTP ${res.status}`}`);
  return body.data;
}
