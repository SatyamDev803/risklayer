const STEPS = [
  {
    title: "Ask before acting",
    body: "Before a swap, the trading agent asks Risklayer one question: may I trade this size, within my price impact limit?",
    href: "#check",
    link: "Ask one now",
  },
  {
    title: "Pay agent to agent",
    body: "Risklayer answers 402 with an HSP Cart Mandate it has signed. The agent checks the terms, then signs a gasless EIP-3009 authorization and 0.25 USDC moves on chain.",
    href: "#connect",
    link: "See the payment terms",
  },
  {
    title: "Decide from live data",
    body: "A live HSKSwap quote, the pool's 10 minute average and the APRO oracle go through fixed rules. No model decides. Missing data blocks.",
    href: "#check",
    link: "See the rules",
  },
  {
    title: "Verify, then obey",
    body: "The agent recomputes the answer's hash and checks it is for its own question. Then it blocks, shrinks, or trades with a slippage floor.",
    href: "#activity",
    link: "See paid answers",
  },
];

const PROOFS = [
  ["1206 bps.", "A 60,000 USDT buy of WHSK would move the pool that much. Risklayer says about 4,300 USDT fits under 100 bps."],
  ["Same bytes, same hash.", "Answers use canonical JSON, the same rules HSP uses to sign its carts. Change one field and the agent refuses."],
  ["On HSK Chain.", "Each paid answer can be written to a receipt contract on mainnet: which hash the seller stood behind, for which payment."],
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 pt-14">
      <h2 className="font-display text-[32px] font-semibold tracking-[-0.03em]">How it works</h2>
      <p className="mt-2 text-[17px] text-label-2">Four steps between an agent and its money.</p>
      <ol className="mt-6 grid gap-px overflow-hidden rounded-[22px] bg-hairline shadow-card sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col bg-surface p-5">
            <span className="num grid size-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--blue)_14%,transparent)] text-[15px] font-semibold text-blue">{i + 1}</span>
            <h3 className="mt-4 font-display text-[17px] font-semibold tracking-[-0.02em]">{s.title}</h3>
            <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-label-2">{s.body}</p>
            <a href={s.href} className="mt-4 text-[14px] font-medium text-blue hover:underline">{s.link}</a>
          </li>
        ))}
      </ol>
      <ul className="mt-8 grid gap-6 sm:grid-cols-3">
        {PROOFS.map(([lead, body]) => (
          <li key={lead} className="text-[15px] leading-snug">
            <span className="font-semibold">{lead}</span> <span className="text-label-2">{body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
