/**
 * HSP signing primitives, implemented from the HashKey Merchant docs:
 * - AppAuth HMAC on every /merchant/* call
 * - ES256K `merchant_authorization` JWT bound to the cart via `cart_hash`
 * - webhook `X-Signature: t=<ts>,v1=<hmac>` verification
 */
import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";

import { canonicalize, sha256Hex } from "../verdict/canonical.js";

/* ---------------- AppAuth HMAC ---------------- */

export interface HmacInput {
  method: string;
  path: string;
  query?: string;
  /** Already-canonical JSON body, or undefined for GET. */
  body?: string;
  timestamp: string;
  nonce: string;
}

export function hmacMessage(i: HmacInput): string {
  const bodyHash = i.body === undefined || i.body === "" ? "" : sha256Hex(i.body);
  return [i.method.toUpperCase(), i.path, i.query ?? "", bodyHash, i.timestamp, i.nonce].join("\n");
}

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export function signedHeaders(appKey: string, appSecret: string, req: Omit<HmacInput, "timestamp" | "nonce">): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  return {
    "X-App-Key": appKey,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": hmacHex(appSecret, hmacMessage({ ...req, timestamp, nonce })),
  };
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------------- ES256K merchant JWT ---------------- */

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function cartHash(contents: unknown): string {
  return sha256Hex(canonicalize(contents));
}

export interface MerchantJwtClaims {
  iss: string;
  sub: string;
  aud: "HashkeyMerchant";
  iat: number;
  exp: number;
  jti: string;
  cart_hash: string;
}

export function signMerchantJwt(privateKeyPem: string, merchantName: string, contents: unknown, ttlSec: number): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims: MerchantJwtClaims = {
    iss: merchantName,
    sub: merchantName,
    aud: "HashkeyMerchant",
    iat,
    exp: iat + ttlSec,
    jti: `JWT-${iat}-${randomBytes(6).toString("hex")}`,
    cart_hash: cartHash(contents),
  };
  const signingInput = `${b64url(JSON.stringify({ alg: "ES256K", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  // ieee-p1363 gives the raw r||s form JWS requires (not DER).
  const signature = sign("sha256", Buffer.from(signingInput), { key: createPrivateKey(privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** Returns the claims when the JWT is a valid ES256K signature by this key,
 * unexpired, and bound to exactly these cart contents. Otherwise throws. */
export function verifyMerchantJwt(jwt: string, publicKey: string | KeyObject, contents: unknown): MerchantJwtClaims {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) throw new Error("malformed JWT");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string };
  if (header.alg !== "ES256K") throw new Error(`JWT alg must be ES256K, got ${header.alg}`);
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("JWT signature does not match the merchant key");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as MerchantJwtClaims;
  if (claims.aud !== "HashkeyMerchant") throw new Error("JWT audience is not HashkeyMerchant");
  if (claims.exp * 1000 < Date.now()) throw new Error("JWT expired");
  if (claims.cart_hash !== cartHash(contents)) throw new Error("cart_hash does not match the cart contents");
  return claims;
}

export function publicKeyPem(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
}

/* ---------------- Webhooks ---------------- */

export function signWebhook(appSecret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacHex(appSecret, `${timestamp}.${rawBody}`)}`;
}

/** Zero-trust: empty secret or missing header is an error, never a pass. */
export function verifyWebhook(appSecret: string, rawBody: string, header: string | undefined, toleranceSec = 300, now = Date.now()): void {
  if (!appSecret) throw new Error("webhook secret is not configured");
  if (!header) throw new Error("missing X-Signature header");
  let ts = NaN;
  let v1 = "";
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t") ts = Number(v);
    if (k === "v1") v1 = v ?? "";
  }
  if (!Number.isFinite(ts) || !v1) throw new Error("malformed X-Signature header");
  if (Math.abs(now / 1000 - ts) > toleranceSec) throw new Error("webhook timestamp outside tolerance");
  if (!safeEqualHex(hmacHex(appSecret, `${ts}.${rawBody}`), v1)) throw new Error("webhook signature mismatch");
}
