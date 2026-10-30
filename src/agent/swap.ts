/**
 * Executes an allowed swap on HSKSwap with its own protection: a fresh quote
 * taken right before sending, and amountOutMinimum derived from it. A
 * Risklayer ALLOW never replaces transaction-level slippage limits.
 */
import { createWalletClient, http, type Address, type Hex, type LocalAccount } from "viem";

import { HSK_MAINNET, HSKSWAP } from "../config.js";
import { abis, hskMainnet, mainnet } from "../hsk/client.js";
import { quote } from "../hsk/market.js";

export interface SwapPlan {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountIn: bigint;
  freshQuote: bigint;
  amountOutMinimum: bigint;
  slippageBps: number;
}

export async function planSwap(tokenIn: Address, tokenOut: Address, fee: number, amountIn: bigint, slippageBps: number): Promise<SwapPlan> {
  const freshQuote = await quote(tokenIn, tokenOut, fee, amountIn);
  if (freshQuote === null || freshQuote === 0n) throw new Error("fresh quote failed, refusing to swap");
  return { tokenIn, tokenOut, fee, amountIn, freshQuote, amountOutMinimum: (freshQuote * BigInt(10_000 - slippageBps)) / 10_000n, slippageBps };
}

export async function executeSwap(account: LocalAccount, plan: SwapPlan): Promise<{ approveTx?: Hex; swapTx: Hex; status: "success" | "reverted" }> {
  const wallet = createWalletClient({ chain: hskMainnet, transport: http(HSK_MAINNET.rpc), account });
  const balance = await mainnet.readContract({ address: plan.tokenIn, abi: abis.erc20, functionName: "balanceOf", args: [account.address] });
  if (balance < plan.amountIn) throw new Error(`agent wallet holds ${balance} base units, needs ${plan.amountIn}`);

  let approveTx: Hex | undefined;
  const allowance = await mainnet.readContract({ address: plan.tokenIn, abi: abis.erc20, functionName: "allowance", args: [account.address, HSKSWAP.swapRouter02] });
  if (allowance < plan.amountIn) {
    approveTx = await wallet.writeContract({ address: plan.tokenIn, abi: abis.erc20, functionName: "approve", args: [HSKSWAP.swapRouter02, plan.amountIn] });
    await mainnet.waitForTransactionReceipt({ hash: approveTx });
  }
  const swapTx = await wallet.writeContract({
    address: HSKSWAP.swapRouter02,
    abi: abis.swapRouter02,
    functionName: "exactInputSingle",
    args: [{ tokenIn: plan.tokenIn, tokenOut: plan.tokenOut, fee: plan.fee, recipient: account.address, amountIn: plan.amountIn, amountOutMinimum: plan.amountOutMinimum, sqrtPriceLimitX96: 0n }],
  });
  const receipt = await mainnet.waitForTransactionReceipt({ hash: swapTx });
  return { approveTx, swapTx, status: receipt.status };
}
