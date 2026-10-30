/**
 * Buyer client: ask a Risklayer question, pay through HSP when the seller
 * answers 402, then verify the answer before returning it. Nothing here
 * trusts the seller: terms are checked before signing, and the answer is
 * re-hashed and matched to the request before it is used.
 */
import type { Address, LocalAccount } from "viem";

import type { PaymentNetwork } from "../config.js";
import { buildMandate, checkChallenge, submitMandate, type PaymentChallenge } from "../hsp/payer.js";
import { verifyEnvelope, type Envelope } from "../verdict/envelope.js";

export interface Catalogue {
  payment: { protocol: string; hspMode: "hsp" | "local"; network: PaymentNetwork; chainId: number; payTo: Address; payMandateUrl: string; token: { symbol: string } };
  merchant: { name: string; publicKeyPem: string };
  receipts: { chainId: number; address: Address } | null;
  skus: { id: string; priceUsd: string }[];
}

export type PaidAnswer = Envelope & {
  payment: { mode: string; label: string; status: string; simulated: boolean; payer?: Address; tx?: string; network: string; chainId: number; amountUsd: string; paymentRequestId: string };
  receipt: { chainId: number; contract: Address; tx: string | null; error?: string } | null;
};

export type Outcome =
  | { ok: true; answer: PaidAnswer; requestId: string }
  | { ok: false; stage: "terms" | "payment" | "verify"; problems: string[]; requestId?: string; answer?: PaidAnswer };

export interface BuyerOptions {
  seller: string;
  account: LocalAccount;
  maxUsdPerCall: number;
  currentBlock?: () => Promise<number>;
  onStep?: (text: string) => void;
}

export class Buyer {
  private catalogue?: Catalogue;
  constructor(private opts: BuyerOptions) {}

  async discover(): Promise<Catalogue> {
    const res = await fetch(`${this.opts.seller}/catalogue`);
    if (!res.ok) throw new Error(`catalogue unavailable: HTTP ${res.status}`);
    this.catalogue = (await res.json()) as Catalogue;
    return this.catalogue;
  }

  async ask(sku: string, query: Record<string, string>): Promise<Outcome> {
    const cat = this.catalogue ?? (await this.discover());
    const say = this.opts.onStep ?? (() => {});
    const qs = new URLSearchParams(query).toString();
    const url = `${this.opts.seller}/v1/${sku}?${qs}`;

    const first = await fetch(url);
    if (first.status === 400) throw new Error(`seller rejected the question: ${((await first.json()) as { error: string }).error}`);
    if (first.status !== 402) throw new Error(`expected 402 Payment Required, got HTTP ${first.status}`);
    const challenge = (await first.json()) as PaymentChallenge & { query: Record<string, string> };
    say(`402: ${challenge.priceUsd} USD for ${sku}, request ${challenge.requestId.slice(0, 8)}, via ${challenge.hsp.label}`);

    const termProblems = checkChallenge(challenge, {
      maxUsdPerCall: this.opts.maxUsdPerCall,
      expectedPayTo: cat.payment.payTo,
      merchantPublicKeyPem: cat.merchant.publicKeyPem,
      network: cat.payment.network,
    });
    if (termProblems.length) return { ok: false, stage: "terms", problems: termProblems, requestId: challenge.requestId };
    say("Seller terms check out: signed by the published merchant key, right payee, right token, within budget");

    const mandate = await buildMandate(this.opts.account, challenge, cat.payment.network);
    say(`Signed EIP-3009 authorization for ${mandate.payment_mandate_contents.payment_response.details.payload.authorization.value} base units of ${cat.payment.token.symbol}`);
    try {
      const submitted = await submitMandate(challenge.hsp.payMandateUrl, mandate);
      say(`Payment Mandate accepted by the gateway: ${submitted.status}`);
    } catch (e) {
      return { ok: false, stage: "payment", problems: [(e as Error).message], requestId: challenge.requestId };
    }

    const deadline = Date.now() + 90_000;
    let answer: PaidAnswer | undefined;
    while (Date.now() < deadline) {
      const res = await fetch(url, { headers: { "X-Risklayer-Request": challenge.requestId } });
      if (res.status === 200) {
        answer = (await res.json()) as PaidAnswer;
        break;
      }
      if (res.status !== 402) return { ok: false, stage: "payment", problems: [`seller answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`], requestId: challenge.requestId };
      const body = (await res.json()) as { payment?: { status: string; reason?: string } };
      if (body.payment?.status === "payment-failed") return { ok: false, stage: "payment", problems: [`payment failed: ${body.payment.reason ?? "no reason given"}`], requestId: challenge.requestId };
      await new Promise(r => setTimeout(r, 1_500));
    }
    if (!answer) return { ok: false, stage: "payment", problems: ["payment did not settle within 90 seconds"], requestId: challenge.requestId };
    say(`Paid (${answer.payment.status}${answer.payment.simulated ? ", simulated" : ""}). Answer received for block ${answer.proof.blockNumber}`);

    const problems = verifyEnvelope(answer, {
      requestId: challenge.requestId,
      sku,
      query: challenge.query,
      currentBlock: this.opts.currentBlock ? await this.opts.currentBlock() : undefined,
    });
    if (problems.length) return { ok: false, stage: "verify", problems, requestId: challenge.requestId, answer };
    return { ok: true, answer, requestId: challenge.requestId };
  }
}
