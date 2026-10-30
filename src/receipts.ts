/**
 * Writes one RisklayerReceipts.record() per paid answer on HSK mainnet.
 * The receipt is an audit record: it shows which answer (by hash) the seller
 * stood behind for which payment. It does not prove the data was true.
 */
import { createWalletClient, http, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { HSK_MAINNET } from "./config.js";
import { hskMainnet } from "./hsk/client.js";
import type { Envelope, Verdict } from "./verdict/envelope.js";

export const RECEIPTS_ABI = parseAbi([
  "function record(bytes32 paymentRef, bytes32 resultHash, address payer, uint8 verdict, string sku)",
  "function receipts(bytes32 paymentRef) view returns (bytes32 resultHash, address payer, uint8 verdict, uint64 recordedAt, string sku)",
  "function count() view returns (uint256)",
  "event AnswerRecorded(bytes32 indexed paymentRef, bytes32 indexed resultHash, address indexed payer, uint8 verdict, string sku)",
]);

export const VERDICT_CODE: Record<Verdict, number> = { INFO: 0, ALLOW: 1, REDUCE: 2, BLOCK: 3, HOLD: 4 };

export const paymentRef = (paymentRequestId: string): Hex => keccak256(toBytes(paymentRequestId));

export function receiptsWriter() {
  const address = process.env.RECEIPTS_ADDRESS?.trim() as Address | undefined;
  const key = process.env.SELLER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!address || !key) return null;
  const wallet = createWalletClient({ chain: hskMainnet, transport: http(HSK_MAINNET.rpc), account: privateKeyToAccount(key) });
  return {
    address,
    async record(paymentRequestId: string, env: Envelope, payer: Address): Promise<Hex> {
      return wallet.writeContract({
        address,
        abi: RECEIPTS_ABI,
        functionName: "record",
        args: [paymentRef(paymentRequestId), `0x${env.proof.resultHash.replace("sha256:", "")}`, payer, VERDICT_CODE[env.verdict], env.sku],
      });
    },
  };
}
