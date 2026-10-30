export type Verdict = "ALLOW" | "REDUCE" | "BLOCK" | "HOLD" | "INFO";

export interface Sku {
  id: string;
  title: string;
  question: string;
  description: string;
  priceUsd: string;
  example: string;
  decides: boolean;
  path: string;
  previewPath: string;
}

export interface Catalogue {
  name: string;
  tagline: string;
  payment: {
    protocol: string;
    hspMode: "hsp" | "local";
    network: string;
    chainId: number;
    token: { symbol: string; address: string; decimals: number };
    payTo: string;
    payMandateUrl: string;
  };
  merchant: { name: string; publicKeyPem: string };
  receipts: { chainId: number; address: string } | null;
  skus: Sku[];
}

export interface Payment {
  mode: string;
  label: string;
  status: string;
  simulated: boolean;
  payer?: string;
  tx?: string;
  network: string;
  chainId: number;
  amountUsd: string;
}

export type AgentEvent =
  | { type: "step"; title: string }
  | { type: "note"; text: string }
  | { type: "answer"; sku: string; verdict: Verdict; reasons: string[]; resultHash: string; requestId: string; blockNumber: number; payment: Payment; receipt: { contract: string; tx: string | null; error?: string } | null; data: Record<string, unknown> }
  | { type: "rejected"; stage: string; problems: string[]; claimedVerdict?: Verdict }
  | { type: "swap-plan"; freshQuote: string; minimumOut: string; tokenOut: string; slippageBps: number }
  | { type: "swap"; status: string; tx: string; approveTx?: string }
  | { type: "done"; outcome: "refused" | "dry-run" | "swapped" | "stopped"; summary: string };

export interface ActivityEntry {
  ts: string;
  requestId?: string;
  sku: string;
  query: Record<string, string>;
  mode: "paid" | "preview";
  verdict?: Verdict;
  reasons?: string[];
  resultHash?: string;
  blockNumber?: number;
  payment?: { mode: "hsp" | "local"; status: string; simulated: boolean; payer?: string; tx?: string; network: string; amountUsd: string };
  receiptTx?: string;
  ok: boolean;
  error?: string;
}

export interface Preview {
  preview: true;
  sku: string;
  verdict: Verdict;
  reasons: string[];
  blockNumber: number;
  note: string;
}
