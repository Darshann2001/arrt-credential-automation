"use client";

import type { ReactNode } from "react";
import { RefreshCw, ServerCrash } from "lucide-react";
import { Button } from "./button";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  children,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/60 px-6 py-12 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
        <ServerCrash className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-lg text-sm text-slate-600">{message}</p>
      {onRetry ? (
        <Button
          variant="secondary"
          className="mt-5"
          onClick={onRetry}
          aria-label={retryLabel}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
