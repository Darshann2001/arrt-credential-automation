"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { RecordSortField, SortOrder } from "@/lib/types";
import { cn } from "@/lib/cn";

export function SortHeader({
  field,
  label,
  sortBy,
  sortOrder,
  onSort,
  className,
}: {
  field: RecordSortField;
  label: string;
  sortBy: RecordSortField;
  sortOrder: SortOrder;
  onSort: (field: RecordSortField) => void;
  className?: string;
}) {
  const active = sortBy === field;
  const ariaSort = active
    ? sortOrder === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const Icon = active
    ? sortOrder === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
          active && "text-brand-700"
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </th>
  );
}
