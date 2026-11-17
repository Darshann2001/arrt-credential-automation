"use client";

import Link from "next/link";
import type { CollectionJob } from "@/lib/types";
import { formatDateTime, shortId } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

const COUNTER_COLUMNS = [
  { key: "requestedTarget", label: "Target" },
  { key: "recordsFound", label: "Found" },
  { key: "recordsInserted", label: "Inserted" },
  { key: "recordsSkipped", label: "Skipped" },
  { key: "recordsRejected", label: "Rejected" },
] as const;

export function JobsTable({
  jobs,
  loading,
}: {
  jobs: CollectionJob[];
  loading: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Job
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </th>
            {COUNTER_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {column.label}
              </th>
            ))}
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Started
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Completed
            </th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              Details
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <tr key={index}>
                  {Array.from({ length: 11 }).map((__, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3.5">
                      <Skeleton className={cnSkeleton(cellIndex)} />
                    </td>
                  ))}
                </tr>
              ))
            : jobs.map((job) => (
                <tr key={job.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
                      title={job.id}
                    >
                      {shortId(job.id)}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-400">{job.source}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                    {job.requestedTarget.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                    {job.recordsFound.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums font-medium text-emerald-700">
                    {job.recordsInserted.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                    {job.recordsSkipped.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-amber-700">
                    {job.recordsRejected.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {formatDateTime(job.startedAt)}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {formatDateTime(job.completedAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      View
                      <span className="sr-only"> details for job {job.id}</span>
                    </Link>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

function cnSkeleton(index: number): string {
  if (index === 0) return "h-4 w-20";
  if (index === 1) return "h-5 w-16 rounded-full";
  if (index >= 7) return "ml-auto h-4 w-16";
  return "ml-auto h-4 w-8";
}
