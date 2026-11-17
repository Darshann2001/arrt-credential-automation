"use client";

import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Select({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-slate-700"
        >
          {label}
        </label>
      ) : null}

      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [errorId, hintId].filter(Boolean).join(" ") || undefined
          }
          className={cn(
            "block w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-slate-50",
            error &&
              "border-red-300 focus:border-red-500 focus:ring-red-500/20",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
