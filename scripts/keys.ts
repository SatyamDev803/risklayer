/**
 * Generates fresh keys for a Risklayer deployment and prints .env lines.
 * Writes the merchant secp256k1 key to merchant_private_key.pem (gitignored)
 * and prints its public key, which is what HashKey needs for HSP onboarding.
 * Nothing is sent anywhere.
 */
import { existsSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PEM_PATH = "merchant_private_key.pem";
if (existsSync(PEM_PATH)) {
  console.error(`${PEM_PATH} already exists. Move it away first; this script never overwrites keys.`);
  process.exit(1);
}

const wallet = (label: string) => {
  const key = generatePrivateKey();
  return { label, key, address: privateKeyToAccount(key).address };
};
const seller = wallet("seller");
const agent = wallet("agent");
const relayer = wallet("relayer");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
writeFileSync(PEM_PATH, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });

console.log("# Add these to .env (never commit it)");
console.log(`SELLER_PRIVATE_KEY=${seller.key}`);
console.log(`SELLER_ADDRESS=${seller.address}`);
console.log(`AGENT_PRIVATE_KEY=${agent.key}`);
console.log(`RELAYER_PRIVATE_KEY=${relayer.key}`);
console.log(`MERCHANT_KEY_PATH=${PEM_PATH}`);
console.log("");
console.log("# Fund on HSK Chain (177):");
console.log(`#   seller  ${seller.address}  ~2 HSK for the contract deploy and receipts`);
console.log(`#   agent   ${agent.address}  USDC.e for paying checks, USDT for the demo swap, ~1 HSK for gas`);
console.log(`#   relayer ${relayer.address}  ~1 HSK, only for the local gateway`);
console.log("");
console.log("# Merchant public key for HSP onboarding (public_key field):");
console.log(publicKey.export({ type: "spki", format: "pem" }).toString());
