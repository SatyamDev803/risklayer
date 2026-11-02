export const HSK_RPC = "https://mainnet.hsk.xyz";

/** RisklayerReceipts.count(), read straight from HSK mainnet by the browser
 * (selector of `count()`), so the number on screen does not depend on our API. */
export async function receiptsCount(contract: string): Promise<number | null> {
  try {
    const res = await fetch(HSK_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data: "0x06661abd" }, "latest"] }),
    });
    const body = (await res.json()) as { result?: string };
    return body.result ? Number(BigInt(body.result)) : null;
  } catch {
    return null;
  }
}
