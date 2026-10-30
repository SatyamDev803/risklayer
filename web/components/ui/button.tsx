import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/format";

export const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,transform,opacity,filter] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      tone: {
        primary: "bg-blue text-white hover:brightness-110",
        tinted: "bg-[color-mix(in_srgb,var(--blue)_14%,transparent)] text-blue hover:bg-[color-mix(in_srgb,var(--blue)_20%,transparent)]",
        plain: "bg-fill text-label hover:bg-fill-strong",
        ghost: "text-blue hover:bg-fill",
      },
      size: {
        sm: "h-8 rounded-full px-3.5 text-[13px]",
        md: "h-9 rounded-full px-4 text-[15px]",
        lg: "h-11 rounded-full px-5 text-[16px]",
        icon: "size-9 rounded-full",
      },
    },
    defaultVariants: { tone: "plain", size: "md" },
  },
);

export function Button({ tone, size, className, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonStyles>) {
  return <button type="button" className={cn(buttonStyles({ tone, size }), className)} {...props} />;
}
