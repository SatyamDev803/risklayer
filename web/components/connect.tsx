"use client";

import { Bot, Copy, Globe, Wallet, type LucideIcon } from "lucide-react";

import { explorerAddress, short } from "@/lib/format";
import type { Catalogue } from "@/lib/types";
import { Card, Group } from "./ui/card";

function CopyLine({ text, label, onCopied }: { text: string; label: string; onCopied: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-2xl bg-surface-2 p-1.5 pl-4">
      <code translate="no" className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] leading-6 text-label-2">{text}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          onCopied();
        }}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-label-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-[transform,color] duration-150 hover:text-label active:scale-[0.94]"
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

function Way({ icon: Icon, color, title, body, children }: { icon: LucideIcon; color: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[22px] bg-surface p-5 shadow-card">
      <span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: color }}>
        <Icon className="size-5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-display text-[17px] font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-1 flex-1 text-[14px] leading-relaxed text-label-2">{body}</p>
      {children}
    </div>
  );
}

export function Connect({ catalogue, apiUrl, notify }: { catalogue: Catalogue | null; apiUrl: string; notify: (t: string) => void }) {
  const copied = () => notify("Copied");
  return (
    <section id="connect" className="scroll-mt-20 pt-14">
      <h2 className="font-display text-[32px] font-semibold tracking-[-0.03em]">Three ways in</h2>
      <p className="mt-2 text-[17px] text-label-2">Each one runs the same rules on the same HSK mainnet data.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3 lg:gap-5">
        <Way icon={Bot} color="linear-gradient(135deg,#5AC8FA,#007AFF)" title="Inside Claude" body="Six MCP tools with free verdicts and reasons. No wallet needed.">
          <CopyLine label="MCP command" onCopied={copied} text={`claude mcp add --transport http risklayer ${apiUrl}/mcp`} />
        </Way>
        <Way icon={Wallet} color="linear-gradient(135deg,#A5A3FF,#5856D6)" title="Agents with a wallet" body="Ask, get 402 with signed HSP terms, pay in USDC, then ask again with the request id.">
          <CopyLine label="paid request" onCopied={copied} text={`curl -i '${apiUrl}/v1/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=300'`} />
        </Way>
        <Way icon={Globe} color="linear-gradient(135deg,#7BE495,#34C759)" title="Anyone" body="The verdict and the reasons over plain HTTP, without evidence or proof.">
          <CopyLine label="preview request" onCopied={copied} text={`curl '${apiUrl}/preview/trade-gate?tokenIn=USDT&tokenOut=WHSK&amountIn=60000'`} />
        </Way>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-12 lg:gap-5">
        <Card title="Checks for sale" aside={catalogue ? `${catalogue.skus.length} checks` : "Loading"} className="lg:col-span-7">
          <Group className="m-3">
            {(catalogue?.skus ?? []).map(s => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{s.title}</div>
                  <div className="text-[13px] leading-snug text-label-2">{s.question} {s.description}</div>
                </div>
                <span className="num shrink-0 rounded-full bg-fill px-2.5 py-1 text-[13px] font-semibold">${s.priceUsd}</span>
              </li>
            ))}
            {!catalogue && <li className="px-4 py-6 text-center text-[15px] text-label-2">The Risklayer API is not reachable.</li>}
          </Group>
        </Card>

        <Card title="Settlement" className="lg:col-span-5">
          <Group className="m-3">
            <Info label="Paid through" value={catalogue?.payment.hspMode === "hsp" ? "HSP" : "Local gateway"} sub={catalogue?.payment.protocol} />
            <Info label="Currency" value={catalogue ? `${catalogue.payment.token.symbol}, chain ${catalogue.payment.chainId}` : "-"} sub={catalogue?.payment.network} />
            <Info label="Payee" value={catalogue ? short(catalogue.payment.payTo) : "-"} href={catalogue ? explorerAddress(catalogue.payment.payTo) : undefined} />
            <Info label="Receipts" value={catalogue?.receipts ? short(catalogue.receipts.address) : "Off"} sub={catalogue?.receipts ? "RisklayerReceipts on HSK mainnet" : "Deploy the contract to turn on"} href={catalogue?.receipts ? explorerAddress(catalogue.receipts.address) : undefined} />
          </Group>
          <div className="space-y-2 px-5 pb-5 text-[14px] leading-relaxed text-label-2">
            <p><span className="font-semibold text-label">What the hash proves.</span> The answer was not changed after the seller made it, and it belongs to this question.</p>
            <p><span className="font-semibold text-label">What it does not.</span> That the data is true. Every number names its source and block, so anyone can read it again.</p>
            <p><span className="font-semibold text-label">The receipt</span> records which answer the seller stood behind for which payment. It is not escrow.</p>
          </div>
        </Card>
      </div>
    </section>
  );
}

function Info({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {sub && <div className="truncate text-[12px] text-label-2">{sub}</div>}
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="num shrink-0 font-mono text-[13px] text-blue hover:underline" translate="no">{value}</a>
      ) : (
        <span className="num shrink-0 text-[15px] font-medium">{value}</span>
      )}
    </li>
  );
}
