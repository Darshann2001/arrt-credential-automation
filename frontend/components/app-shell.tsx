"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus, Wifi, WifiOff } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiHealth } from "@/lib/use-api-health";

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/records") return "Credential Records";
  if (pathname === "/jobs") return "Collection Jobs";
  if (pathname === "/jobs/new") return "Create Collection Job";
  if (pathname.startsWith("/jobs/")) return "Job Details";
  return "ARRT Admin";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const apiStatus = useApiHealth();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [sidebarOpen]);

  const statusLabel =
    apiStatus === "online"
      ? "API online"
      : apiStatus === "offline"
        ? "API offline"
        : "Checking API";

  return (
    <div className="min-h-screen">
      <Sidebar
        open={sidebarOpen}
        pathname={pathname}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
                aria-label="Open navigation"
                aria-expanded={sidebarOpen}
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>

              <nav
                aria-label="Breadcrumb"
                className="hidden items-center gap-2 text-sm sm:flex"
              >
                <span className="text-slate-400">Admin</span>
                <span className="text-slate-300" aria-hidden="true">
                  /
                </span>
                <span className="truncate font-medium text-slate-700">
                  {pageTitle(pathname)}
                </span>
              </nav>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
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

              <Link
                href="/jobs/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">New job</span>
                <span className="sr-only sm:hidden">New job</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
