import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { nonceFor, recoverAuthorizer, signAuthorization, usdToUnits } from "./eip3009.js";
import { cartHash, hmacMessage, publicKeyPem, signMerchantJwt, signWebhook, verifyMerchantJwt, verifyWebhook } from "./signing.js";

const pem = () => generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("AppAuth HMAC message", () => {
  it("joins the six parts with newlines and leaves bodyHash blank for GET", () => {
    expect(hmacMessage({ method: "get", path: "/api/v1/merchant/payments", query: "cart_mandate_id=ORDER-123", timestamp: "1709123456", nonce: "a3f1b2c4d5e6" }))
      .toBe("GET\n/api/v1/merchant/payments\ncart_mandate_id=ORDER-123\n\n1709123456\na3f1b2c4d5e6");
  });
  it("hashes the body for POST", () => {
    const m = hmacMessage({ method: "POST", path: "/api/v1/merchant/orders", body: "{}", timestamp: "1", nonce: "n" }).split("\n");
    expect(m[2]).toBe("");
    expect(m[3]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("merchant JWT", () => {
  const key = pem();
  const contents = { id: "cart-1", merchant_name: "Risklayer", total: "0.25" };

  it("verifies against the public key and the exact cart", () => {
    const jwt = signMerchantJwt(key, "Risklayer", contents, 600);
    const claims = verifyMerchantJwt(jwt, publicKeyPem(key), contents);
    expect(claims.cart_hash).toBe(cartHash(contents));
    expect(claims.aud).toBe("HashkeyMerchant");
    expect(JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString())).toEqual({ alg: "ES256K", typ: "JWT" });
  });

  it("rejects a changed cart", () => {
    const jwt = signMerchantJwt(key, "Risklayer", contents, 600);
    expect(() => verifyMerchantJwt(jwt, publicKeyPem(key), { ...contents, total: "0.01" })).toThrow(/cart_hash/);
  });

  it("rejects another merchant's key", () => {
    const jwt = signMerchantJwt(key, "Risklayer", contents, 600);
    expect(() => verifyMerchantJwt(jwt, publicKeyPem(pem()), contents)).toThrow(/signature/);
  });
});

describe("webhook signature", () => {
  const body = '{"status":"payment-included"}';
  it("accepts a fresh, correct signature", () => {
    expect(() => verifyWebhook("secret", body, signWebhook("secret", body))).not.toThrow();
  });
  it("rejects a tampered body", () => {
    expect(() => verifyWebhook("secret", body.replace("included", "finalized"), signWebhook("secret", body))).toThrow(/mismatch/);
  });
  it("rejects an old timestamp", () => {
    expect(() => verifyWebhook("secret", body, signWebhook("secret", body, Math.floor(Date.now() / 1000) - 900))).toThrow(/tolerance/);
  });
  it("never passes without a header or secret", () => {
    expect(() => verifyWebhook("secret", body, undefined)).toThrow(/missing/);
    expect(() => verifyWebhook("", body, signWebhook("", body))).toThrow(/secret/);
  });
});

describe("EIP-3009 authorization", () => {
  it("recovers the signer for USDC.e on HSK mainnet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const auth = { from: account.address, to: privateKeyToAccount(generatePrivateKey()).address, value: "250000", validAfter: "0", validBefore: "9999999999", nonce: nonceFor("PR-1") };
    const sig = await signAuthorization(account, "hashkey", auth);
    expect(await recoverAuthorizer("hashkey", auth, sig)).toBe(account.address);
    expect(await recoverAuthorizer("hashkey", { ...auth, value: "1" }, sig)).not.toBe(account.address);
  });
  it("converts USD prices to 6 decimal units exactly", () => {
    expect(usdToUnits("0.25", 6)).toBe(250000n);
    expect(usdToUnits("1", 6)).toBe(1000000n);
    expect(usdToUnits("0.01", 6)).toBe(10000n);
  });
});
