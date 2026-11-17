"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiHealth } from "@/lib/use-api-health";

export function AppShell({ children }: { children: ReactNode }) {
  const apiStatus = useApiHealth();

  const statusLabel =
    apiStatus === "online"
      ? "API online"
      : apiStatus === "offline"
        ? "API offline"
        : "Checking API";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-slate-900">
              ARRT Credential Records
            </span>
          </Link>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              apiStatus === "online" &&
                "border-emerald-200 bg-emerald-50 text-emerald-700",
              apiStatus === "offline" &&
                "border-red-200 bg-red-50 text-red-700",
              apiStatus === "checking" &&
                "border-slate-200 bg-slate-50 text-slate-500"
            )}
            title={`${statusLabel} · ${API_BASE_URL}`}
            aria-label={`${statusLabel} at ${API_BASE_URL}`}
          >
            {apiStatus === "offline" ? (
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{statusLabel}</span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
