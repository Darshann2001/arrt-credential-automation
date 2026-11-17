"use client";

import type { RecordSortField, SortOrder } from "@/lib/types";
import type { CredentialRecord } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { stateName } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { SortHeader } from "@/components/ui/sort-header";
import { SourceBadge } from "@/components/ui/source-badge";

export function RecordsTable({
  records,
  loading,
  sortBy,
  sortOrder,
  onSort,
}: {
  records: CredentialRecord[];
  loading: boolean;
  sortBy: RecordSortField;
  sortOrder: SortOrder;
  onSort: (field: RecordSortField) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <SortHeader
              field="fullName"
              label="Name"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortHeader
              field="city"
              label="City"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortHeader
              field="state"
              label="State"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortHeader
              field="credentialString"
              label="Credential"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Source
            </th>
            <SortHeader
              field="createdAt"
              label="Added"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <tr key={index}>
                  {Array.from({ length: 6 }).map((__, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3.5">
                      <Skeleton className={cn("h-4", cellIndex === 0 ? "w-40" : "w-24")} />
                    </td>
                  ))}
                </tr>
              ))
            : records.map((record) => (
                <tr key={record.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-3.5 font-medium text-slate-900">
                    {record.fullName}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{record.city || "—"}</td>
                  <td className="px-4 py-3.5 text-slate-600">
                    <span title={stateName(record.state)}>{record.state || "—"}</span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-700">
                    {record.credentialString || "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    <SourceBadge source={record.source} />
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">
                    {formatDate(record.createdAt)}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
