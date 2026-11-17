import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  brand: "border-brand-200 bg-brand-50 text-brand-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-slate-500",
  brand: "bg-brand-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className
      )}
      {...props}
    >
      {dot ? (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
