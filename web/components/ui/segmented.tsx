"use client";

import { cn } from "@/lib/format";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex rounded-full bg-fill p-[3px]", className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-[30px] flex-1 rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200",
            value === o.value ? "bg-segment text-label shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-label-2 hover:text-label",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
