"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  IdCard,
  LayoutDashboard,
  LockKeyhole,
  PlusCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    match: (pathname: string) => pathname === "/",
  },
  {
    href: "/records",
    label: "Credential Records",
    icon: IdCard,
    match: (pathname: string) => pathname.startsWith("/records"),
  },
  {
    href: "/jobs",
    label: "Collection Jobs",
    icon: BriefcaseBusiness,
    match: (pathname: string) =>
      pathname === "/jobs" ||
      (pathname.startsWith("/jobs/") && pathname !== "/jobs/new"),
  },
  {
    href: "/jobs/new",
    label: "Create Job",
    icon: PlusCircle,
    match: (pathname: string) => pathname === "/jobs/new",
  },
];

export function Sidebar({
  open,
  pathname,
  onClose,
}: {
  open: boolean;
  pathname: string;
  onClose: () => void;
}) {
  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-900 text-slate-300 transition-transform duration-200 ease-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <Link
            href="/"
            onClick={onClose}
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">
                ARRT Admin
              </span>
              <span className="block text-[11px] text-slate-400">
                Credential verification
              </span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </p>

          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  active
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px]",
                    active ? "text-brand-300" : "text-slate-500"
                  )}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="rounded-lg bg-white/5 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              Live collection disabled
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              Creating a job records intent only. No browser opens and no ARRT
              request is sent.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
