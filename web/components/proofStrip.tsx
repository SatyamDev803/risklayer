"use client";

import { ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { chainOfNetwork, explorerAddress, explorerTx, fmtNum, timeAgo } from "@/lib/format";
import { receiptsCount } from "@/lib/proof";
import type { ActivityEntry, Catalogue } from "@/lib/types";

/** Fallback so the strip can read the chain even while the API is waking up. */
const RECEIPTS = "0x771d614EF007920e1CFd2b0339A3F5e01daA4E87";

/**
 * Live evidence, not claims: the receipt count is read by the visitor's own
 * browser from HSK mainnet, and the latest payment and receipt link straight
 * to the explorers.
 */
export function ProofStrip({ catalogue, activity }: { catalogue: Catalogue | null; activity: ActivityEntry[] }) {
  const contract = catalogue?.receipts?.address ?? RECEIPTS;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const n = await receiptsCount(contract);
      if (alive && n !== null) setCount(n);
    };
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [contract]);

  const lastPaid = activity.find(e => e.payment?.tx && !e.payment.simulated);
  const lastReceipt = activity.find(e => e.receiptTx);
  const network = catalogue?.payment.network;
  const paidOn = network === "sepolia" ? "USDC on Ethereum Sepolia" : network === "hashkey" ? "USDC on HSK Chain" : "USDC on HSK testnet";

  const items = [
    {
      label: "Paid answers recorded on HSK mainnet",
      value: count === null ? "…" : fmtNum(count, 0),
      sub: "Read live from the contract by your browser",
      href: explorerAddress(contract),
    },
    {
      label: "Latest payment by an agent",
      value: lastPaid ? `$${lastPaid.payment!.amountUsd}` : "Waiting",
      sub: lastPaid ? `${paidOn}, ${timeAgo(lastPaid.ts)}` : "Run the agent below to make one",
      href: lastPaid ? explorerTx(lastPaid.payment!.tx!, chainOfNetwork(lastPaid.payment!.network)) : undefined,
    },
    {
      label: "Latest receipt on chain",
      value: lastReceipt ? lastReceipt.verdict ?? "Recorded" : "Waiting",
      sub: lastReceipt ? `RisklayerReceipts, ${timeAgo(lastReceipt.ts)}` : "Written after every real payment",
      href: lastReceipt ? explorerTx(lastReceipt.receiptTx!) : undefined,
    },
    {
      label: "Receipts contract",
      value: "Verified",
      sub: "Source published on HSK Blockscout",
      href: `${explorerAddress(contract)}?tab=contract`,
    },
  ];

  return (
    <section aria-label="Live on-chain proof" className="mb-12">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-label-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-green" />
        </span>
        Live on chain. Every number links to an explorer.
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] leading-snug text-label-2">{item.label}</span>
                {item.href && <ArrowUpRight className="size-4 shrink-0 text-label-3 transition-colors group-hover:text-blue" aria-hidden="true" />}
              </div>
              <div className="num mt-2 font-display text-[30px] font-semibold leading-none tracking-[-0.03em]" translate="no">{item.value}</div>
              <div className="num mt-1.5 truncate text-[13px] text-label-2">{item.sub}</div>
            </>
          );
          return (
            <motion.li key={item.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24, delay: 0.5 + i * 0.06 }}>
              {item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer" className="group block h-full rounded-[22px] bg-surface p-5 shadow-card transition-transform duration-150 hover:-translate-y-0.5">
                  {body}
                </a>
              ) : (
                <div className="h-full rounded-[22px] bg-surface p-5 shadow-card">{body}</div>
              )}
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
