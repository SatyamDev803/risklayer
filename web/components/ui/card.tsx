import { cn } from "@/lib/format";

export function Card({
  title,
  aside,
  className,
  children,
  id,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 rounded-[22px] bg-surface shadow-card", className)}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-5">
          {title && <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>}
          {aside && <div className="text-[13px] text-label-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** iOS inset grouped list. */
export function Group({ className, children }: { className?: string; children: React.ReactNode }) {
  return <ul className={cn("divide-y divide-hairline overflow-hidden rounded-2xl bg-surface-2", className)}>{children}</ul>;
}
