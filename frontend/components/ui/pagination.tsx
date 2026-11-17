"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PaginationMeta } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { Button } from "./button";

export function Pagination({
  pagination,
  onPageChange,
  itemLabel = "items",
  disabled = false,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  disabled?: boolean;
}) {
  const { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage } =
    pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-500">
        Showing{" "}
        <span className="font-medium text-slate-700">
          {formatNumber(start)}–{formatNumber(end)}
        </span>{" "}
        of <span className="font-medium text-slate-700">{formatNumber(total)}</span>{" "}
        {itemLabel}
      </p>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage || disabled}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        <span className="text-sm text-slate-500">
          Page <span className="font-medium text-slate-700">{page}</span> of{" "}
          <span className="font-medium text-slate-700">
            {Math.max(totalPages, 1)}
          </span>
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage || disabled}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
