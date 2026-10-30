/**
 * Entrypoint: reads .env, picks the HSP mode, mounts the local gateway when
 * needed, and listens. See .env.example for every variable.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createApp } from "./app.js";
import { hspMode, paymentNetwork } from "./config.js";
import { localGateway } from "./hsp/localGateway.js";
import { HspMerchant } from "./hsp/merchant.js";
import { publicKeyPem } from "./hsp/signing.js";
import { mcpHandler } from "./mcp/server.js";
import { receiptsWriter } from "./receipts.js";

const port = Number(process.env.PORT ?? 4021);
const publicUrl = (process.env.PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/$/, "");
const mode = hspMode();
const network = paymentNetwork();

function merchantKey(): string {
  const pem = process.env.MERCHANT_PRIVATE_KEY_PEM?.trim() || (process.env.MERCHANT_KEY_PATH ? readFileSync(process.env.MERCHANT_KEY_PATH, "utf8") : "");
  if (pem) return pem.replace(/\\n/g, "\n");
  if (mode === "hsp") throw new Error("HSP_MODE=hsp needs MERCHANT_PRIVATE_KEY_PEM or MERCHANT_KEY_PATH (the key you registered with HashKey)");
  console.warn("[risklayer] no merchant key set; using a throwaway secp256k1 key for this run");
  return generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function payTo(): Address {
  if (process.env.SELLER_ADDRESS?.trim()) return getAddress(process.env.SELLER_ADDRESS.trim());
  if (process.env.SELLER_PRIVATE_KEY?.trim()) return privateKeyToAccount(process.env.SELLER_PRIVATE_KEY.trim() as Hex).address;
  throw new Error("set SELLER_ADDRESS (where payments land) or SELLER_PRIVATE_KEY");
}

const keyPem = merchantKey();
const appKey = process.env.HSP_APP_KEY?.trim() || (mode === "local" ? `local-${randomBytes(4).toString("hex")}` : "");
const appSecret = process.env.HSP_APP_SECRET?.trim() || (mode === "local" ? randomBytes(32).toString("hex") : "");
if (!appKey || !appSecret) throw new Error("HSP_MODE=hsp needs HSP_APP_KEY and HSP_APP_SECRET from the HashKey merchant console");

const defaultHspBase = network === "hashkey" ? "https://hsp.hashkey.com" : "https://merchant-qa.hashkeymerchant.com";
const hspBase = mode === "local" ? `http://127.0.0.1:${port}/hsp-local` : (process.env.HSP_BASE_URL?.trim() || defaultHspBase);
const payMandateUrl = mode === "local" ? `${publicUrl}/hsp-local/api/v1/payment/pay-mandate` : (process.env.HSP_PAY_MANDATE_URL?.trim() || `${hspBase}/api/v1/payment/pay-mandate`);

const merchant = new HspMerchant({ baseUrl: hspBase, appKey, appSecret, merchantPrivateKeyPem: keyPem, merchantName: process.env.MERCHANT_NAME?.trim() || "Risklayer" });
const merchantPublicKeyPem = publicKeyPem(keyPem);
const receipts = receiptsWriter();

const mounts = [{ path: "/mcp", handler: mcpHandler(publicUrl) }];
if (mode === "local") {
  mounts.push({
    path: "/hsp-local",
    handler: localGateway({
      appKey,
      appSecret,
      merchantPublicKeyPem,
      webhookUrl: `http://127.0.0.1:${port}/v1/hsp/webhook`,
      publicBase: `${publicUrl}/hsp-local`,
      relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY?.trim() as Hex | undefined || undefined,
    }),
  });
}

const app = createApp({
  merchant,
  hspMode: mode,
  network,
  payTo: payTo(),
  merchantPublicKeyPem,
  webhookSecret: appSecret,
  payMandateUrl,
  receipts,
  mounts,
  devBypass: process.env.DEV_BYPASS === "1",
  demoAgent: process.env.DEMO_AGENT === "1"
    ? { account: privateKeyToAccount((process.env.AGENT_PRIVATE_KEY?.trim() as Hex | undefined) || generatePrivateKey()), seller: () => `http://127.0.0.1:${port}`, maxUsdPerCall: Number(process.env.AGENT_MAX_USD_PER_CALL ?? 1) }
    : undefined,
});

app.listen(port, () => {
  console.log(`Risklayer on ${publicUrl}`);
  console.log(`  payments: ${mode === "hsp" ? `HSP at ${hspBase}` : `HSP-compatible local gateway at ${publicUrl}/hsp-local${process.env.RELAYER_PRIVATE_KEY ? " (relaying on chain)" : " (simulated: no RELAYER_PRIVATE_KEY)"}`}`);
  console.log(`  pay in USDC on ${network}, to ${payTo()}`);
  console.log(`  receipts: ${receipts ? receipts.address : "off (set RECEIPTS_ADDRESS and SELLER_PRIVATE_KEY)"}`);
  console.log(`  mcp: ${publicUrl}/mcp`);
  if (process.env.DEMO_AGENT === "1") console.log("  demo agent: POST /v1/demo/agent (dashboard button, never swaps)");
});
