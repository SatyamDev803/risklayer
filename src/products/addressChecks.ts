/**
 * token-check and pay-gate: what is this contract or address? Evidence comes
 * from raw RPC (code, nonce, proxy slot) plus the Blockscout v2 API for
 * verification status and history. Blockscout failures degrade to "unknown",
 * which pay-gate treats as HOLD rather than ALLOW.
 */
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";

import { HSK_MAINNET } from "../config.js";
import { abis, mainnet } from "../hsk/client.js";
import { chainTip } from "../hsk/market.js";
import { payGate as payRule } from "../verdict/rules.js";
import type { ProductResult } from "./types.js";

export function parseAddressQuery(q: URLSearchParams, key: "address" | "token"): Address {
  const value = q.get(key) ?? "";
  if (!isAddress(value)) throw new Error(`${key} must be a 0x address with 40 hex characters`);
  return getAddress(value);
}

interface BlockscoutAddress {
  is_contract?: boolean;
  is_verified?: boolean;
  name?: string | null;
  creation_transaction_hash?: string | null;
}

async function blockscout<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${HSK_MAINNET.explorer}/api/v2${path}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
// ZeppelinOS slot used by Circle's FiatTokenProxy (USDC.e): keccak256("org.zeppelinos.proxy.implementation")
const ZOS_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" as Hex;

/** Function selectors whose presence in bytecode signals a privileged power. */
const POWERS: Record<string, string> = {
  "0x40c10f19": "mint(address,uint256)",
  "0x8456cb59": "pause()",
  "0x3f4ba83a": "unpause()",
  "0xf9f92be4": "blacklist(address)",
  "0xfe575a87": "isBlacklisted(address)",
  "0x8da5cb5b": "owner()",
  "0x3659cfe6": "upgradeTo(address)",
  "0x4f1ef286": "upgradeToAndCall(address,bytes)",
};

function detectPowers(code: Hex): string[] {
  const body = code.toLowerCase();
  // PUSH4 <selector> is how a dispatcher compares selectors.
  return Object.entries(POWERS).filter(([sel]) => body.includes(`63${sel.slice(2)}`)).map(([, sig]) => sig);
}

export async function tokenCheck(token: Address): Promise<ProductResult> {
  const tip = await chainTip();
  const [code, eip1967Slot, zosSlot, meta] = await Promise.all([
    mainnet.getCode({ address: token }),
    mainnet.getStorageAt({ address: token, slot: IMPLEMENTATION_SLOT }),
    mainnet.getStorageAt({ address: token, slot: ZOS_IMPLEMENTATION_SLOT }),
    blockscout<BlockscoutAddress>(`/addresses/${token}`),
  ]);
  if (!code || code === "0x") {
    return { verdict: "BLOCK", reasons: ["There is no contract at this address on HSK Chain."], blockNumber: tip.number, sources: [{ type: "rpc", ref: "eth_getCode", blockNumber: tip.number }], data: { token, hasCode: false } };
  }
  const slotValue = [eip1967Slot, zosSlot].find(v => v && BigInt(v) !== 0n);
  const proxyStandard = slotValue === undefined ? null : slotValue === eip1967Slot ? "EIP-1967" : "ZeppelinOS";
  const implementation = slotValue ? getAddress(`0x${slotValue.slice(-40)}`) : null;
  const implCode = implementation ? await mainnet.getCode({ address: implementation }) : undefined;
  const powers = [...new Set([...detectPowers(code), ...(implCode ? detectPowers(implCode) : [])])];
  const [symbol, decimals, totalSupply] = await Promise.all([
    mainnet.readContract({ address: token, abi: abis.erc20, functionName: "symbol" }).catch(() => null),
    mainnet.readContract({ address: token, abi: abis.erc20, functionName: "decimals" }).catch(() => null),
    mainnet.readContract({ address: token, abi: abis.erc20, functionName: "totalSupply" }).catch(() => null),
  ]);

  const reasons = [
    implementation ? `Upgradeable proxy. The logic can change; current implementation is ${implementation}.` : "Not an upgradeable proxy (EIP-1967 and ZeppelinOS slots are empty).",
    powers.length ? `Admin functions found in bytecode: ${powers.join(", ")}. These are capabilities, not proof of bad intent.` : "No common admin functions found in bytecode.",
    meta ? (meta.is_verified ? "Source is verified on Blockscout." : "Source is not verified on Blockscout.") : "Blockscout did not answer, so verification status is unknown.",
  ];
  return {
    verdict: "INFO",
    reasons,
    blockNumber: tip.number,
    sources: [
      { type: "rpc", ref: "eth_getCode, eth_getStorageAt (proxy slots)", blockNumber: tip.number },
      { type: "blockscout", ref: `${HSK_MAINNET.explorer}/address/${token}` },
    ],
    data: {
      token,
      symbol,
      decimals,
      totalSupply: totalSupply?.toString() ?? null,
      bytecodeHash: keccak256(code),
      bytecodeBytes: (code.length - 2) / 2,
      proxy: implementation ? { standard: proxyStandard, implementation } : null,
      adminFunctions: powers,
      verifiedSource: meta?.is_verified ?? null,
      name: meta?.name ?? null,
    },
  };
}

/** Comma-separated addresses in PAY_GATE_DENYLIST. Empty by default: this is
 * an operator-maintained list, not a sanctions feed. */
function denylist(): Set<string> {
  return new Set((process.env.PAY_GATE_DENYLIST ?? "").split(",").map(a => a.trim().toLowerCase()).filter(Boolean));
}

export async function payGate(address: Address): Promise<ProductResult> {
  const tip = await chainTip();
  const [code, nonce, balance, meta, counters] = await Promise.all([
    mainnet.getCode({ address }),
    mainnet.getTransactionCount({ address }),
    mainnet.getBalance({ address }),
    blockscout<BlockscoutAddress>(`/addresses/${address}`),
    blockscout<{ transactions_count?: string }>(`/addresses/${address}/counters`),
  ]);
  const isContract = !!code && code !== "0x";
  const txCount = counters?.transactions_count !== undefined ? Number(counters.transactions_count) : isContract ? null : nonce;
  const evidence = { denylisted: denylist().has(address.toLowerCase()), isContract, verifiedSource: meta?.is_verified ?? null, txCount, firstSeenAgeDays: null };
  const ruling = payRule(evidence);
  return {
    verdict: ruling.verdict,
    reasons: ruling.reasons,
    blockNumber: tip.number,
    sources: [
      { type: "rpc", ref: "eth_getCode, eth_getTransactionCount, eth_getBalance", blockNumber: tip.number },
      { type: "blockscout", ref: `${HSK_MAINNET.explorer}/address/${address}` },
      { type: "denylist", ref: "PAY_GATE_DENYLIST", note: "operator-maintained list, not a sanctions feed" },
    ],
    data: {
      address,
      isContract,
      codeHash: isContract ? keccak256(code!) : null,
      nonce,
      balanceHsk: Number(balance) / 1e18,
      txCount,
      verifiedSource: evidence.verifiedSource,
      denylisted: evidence.denylisted,
      checks: ruling.checks,
    },
  };
}
