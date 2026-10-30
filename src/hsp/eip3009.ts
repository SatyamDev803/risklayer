/**
 * EIP-3009 TransferWithAuthorization: the signature the paying agent hands to
 * the gateway. The gateway (HSP, or the local one) submits it on chain, so
 * the payer needs no gas, only USDC.
 */
import { hashTypedData, keccak256, parseSignature, recoverTypedDataAddress, toBytes, type Address, type Hex, type LocalAccount } from "viem";

import { PAYMENT_TOKENS, type PaymentNetwork } from "../config.js";

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export function domainFor(network: PaymentNetwork) {
  const t = PAYMENT_TOKENS[network];
  return { name: t.eip712.name, version: t.eip712.version, chainId: t.chainId, verifyingContract: t.address as Address };
}

/** One nonce per payment request: replaying the same authorization for a
 * second order is impossible because the token marks the nonce used. */
export const nonceFor = (paymentRequestId: string): Hex => keccak256(toBytes(`risklayer:${paymentRequestId}`));

const message = (a: Authorization) => ({
  from: a.from,
  to: a.to,
  value: BigInt(a.value),
  validAfter: BigInt(a.validAfter),
  validBefore: BigInt(a.validBefore),
  nonce: a.nonce,
});

export async function signAuthorization(account: LocalAccount, network: PaymentNetwork, a: Authorization): Promise<Hex> {
  return account.signTypedData({ domain: domainFor(network), types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: message(a) });
}

export async function recoverAuthorizer(network: PaymentNetwork, a: Authorization, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain: domainFor(network), types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: message(a), signature });
}

export function authorizationDigest(network: PaymentNetwork, a: Authorization): Hex {
  return hashTypedData({ domain: domainFor(network), types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: message(a) });
}

export function splitSignature(signature: Hex) {
  const { r, s, v, yParity } = parseSignature(signature);
  return { r, s, v: Number(v ?? BigInt(27 + (yParity ?? 0))) };
}

/** USD price string ("0.25") to token base units for a 6-decimal stablecoin. */
export function usdToUnits(usd: string, decimals: number): bigint {
  const [whole, frac = ""] = usd.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}
