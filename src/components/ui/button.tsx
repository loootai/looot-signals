import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-brand text-brand-ink hover:opacity-90 border border-transparent",
  secondary: "bg-panel text-ink border border-line-strong hover:bg-hover",
  ghost: "text-ink hover:bg-hover border border-transparent",
  danger: "bg-panel text-high border border-line-strong hover:bg-high-soft",
  link: "text-link underline-offset-2 hover:underline border border-transparent px-0",
} as const;

const SIZES = {
  md: "h-11 md:h-8 px-3 text-13",
  sm: "h-11 md:h-7 px-2 text-12",
  icon: "h-11 w-11 md:h-8 md:w-8",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  asChild?: boolean;
}

/** Button with the app's variants. Targets are 44 px tall on phones and 32 px on desktop. */
export function Button({ className, variant = "secondary", size = "md", asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-[opacity,background-color,transform] duration-100 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
