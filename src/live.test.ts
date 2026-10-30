/**
 * Live smoke test against HSK mainnet market data, through the full paid
 * loop (local gateway, simulated settlement). Skipped unless LIVE=1:
 *   LIVE=1 npx vitest run src/live.test.ts
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { Buyer } from "./agent/buyer.js";
import { createApp } from "./app.js";
import { chainTip } from "./hsk/market.js";
import { localGateway } from "./hsp/localGateway.js";
import { HspMerchant } from "./hsp/merchant.js";
import { publicKeyPem } from "./hsp/signing.js";

const live = process.env.LIVE === "1";
const keyPem = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const appKey = "live";
const appSecret = randomBytes(16).toString("hex");
let base = "";
let server: Server;

beforeAll(async () => {
  if (!live) return;
  const merchant = new HspMerchant({ baseUrl: "", appKey, appSecret, merchantPrivateKeyPem: keyPem, merchantName: "Risklayer" });
  const app = createApp({
    merchant, hspMode: "local", network: "hashkey", payTo: privateKeyToAccount(generatePrivateKey()).address,
    merchantPublicKeyPem: publicKeyPem(keyPem), webhookSecret: appSecret,
    payMandateUrl: () => `${base}/hsp-local/api/v1/payment/pay-mandate`, receipts: null, allowSimulatedPayments: true, log: () => {},
    demoAgent: { account: privateKeyToAccount(generatePrivateKey()), seller: () => base, maxUsdPerCall: 1 },
    mounts: [{ path: "/hsp-local", handler: localGateway({ appKey, appSecret, merchantPublicKeyPem: publicKeyPem(keyPem), webhookUrl: () => `${base}/v1/hsp/webhook`, publicBase: () => `${base}/hsp-local` }) }],
  });
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (merchant.cfg as { baseUrl: string }).baseUrl = `${base}/hsp-local`;
});

afterAll(() => server?.close());

describe.skipIf(!live)("live HSK mainnet", () => {
  const buyer = () => new Buyer({ seller: base, account: privateKeyToAccount(generatePrivateKey()), maxUsdPerCall: 1, currentBlock: async () => (await chainTip()).number });

  it("REDUCEs an oversized WHSK buy, then ALLOWs the suggested size", async () => {
    const big = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", maxImpactBps: "100" });
    expect(big.ok).toBe(true);
    if (!big.ok) return;
    expect(big.answer.verdict).toBe("REDUCE");
    const suggested = big.answer.data.recommendedAmountIn as string;
    const small = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: suggested, maxImpactBps: "100" });
    expect(small.ok && small.answer.verdict).toBe("ALLOW");
  }, 60_000);

  it("catches the corrupted answer on live data", async () => {
    const r = await buyer().ask("trade-gate", { tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000", maxImpactBps: "100", corrupt: "1" });
    expect(r.ok).toBe(false);
  }, 60_000);

  it("streams the dashboard agent from REDUCE to a planned swap", async () => {
    const res = await fetch(`${base}/v1/demo/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenIn: "USDT", tokenOut: "WHSK", amountIn: "60000" }) });
    const events = (await res.text()).split("\n").filter(Boolean).map(l => JSON.parse(l) as { type: string; verdict?: string; outcome?: string });
    expect(events.filter(e => e.type === "answer").map(e => e.verdict)).toEqual(["REDUCE", "ALLOW"]);
    expect(events.some(e => e.type === "swap-plan")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", outcome: "dry-run" });
  }, 90_000);

  it("answers every catalogue SKU", async () => {
    for (const [sku, q] of [["pool-depth", { tokenA: "USDT", tokenB: "WHSK", amount: "2000" }], ["price-sanity", { tokenA: "WHSK", tokenB: "USDT" }], ["token-check", { token: "0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029" }], ["pay-gate", { address: "0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3" }], ["chain-status", {}]] as const) {
      const r = await buyer().ask(sku, q as Record<string, string>);
      expect(r.ok, `${sku}: ${!r.ok ? r.problems.join() : ""}`).toBe(true);
    }
  }, 120_000);
});
