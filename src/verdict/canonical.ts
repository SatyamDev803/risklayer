/**
 * Canonical JSON (RFC 8785 for the value space we produce): object keys
 * sorted by UTF-16 code units, no whitespace, ECMAScript number formatting.
 * HSP uses the same rules for `cart_hash` and HMAC body hashes, so one
 * implementation serves both the payment leg and the answer proof.
 */
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonical JSON cannot encode NaN or Infinity");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new Error("canonical JSON cannot encode bigint; convert to a decimal string first");
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON cannot encode ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
