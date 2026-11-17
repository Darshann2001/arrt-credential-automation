"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  IdCard,
  PlusCircle,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { describeError, getDashboardStats, getRecords } from "@/lib/api";
import { stateName } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { CredentialRecord, DashboardStats } from "@/lib/types";
import { BarList } from "@/components/ui/bar-list";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/ui/source-badge";
import { StatCard } from "@/components/ui/stat-card";
import { buttonClassName } from "@/components/ui/button";

const EMPTY_STATS: DashboardStats = {
  totalRecords: 0,
  totalJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  recordsAddedRecently: {
    windowDays: 30,
    since: "",
    count: 0,
  },
  recordsByState: [],
  recordsByCredentialType: [],
};

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRecords, setRecentRecords] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    Promise.all([
      getDashboardStats(30, controller.signal),
      getRecords(
        { page: 1, pageSize: 5, sortBy: "createdAt", sortOrder: "desc" },
        controller.signal
      ),
    ])
      .then(([statsResponse, recordsResponse]) => {
        if (!active) return;
        setStats(statsResponse.data);
        setRecentRecords(recordsResponse.data);
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(describeError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Stored credential records and collection job activity."
        />
        <ErrorState
          title="Dashboard data unavailable"
          message={error}
          onRetry={load}
        />
      </div>
    );
  }

  const current = stats ?? EMPTY_STATS;
  const windowDays = current.recordsAddedRecently.windowDays || 30;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Stored credential records and collection job activity. All figures are read live from the API."
        actions={
          <>
            <Link href="/records" className={buttonClassName({ variant: "secondary" })}>
              View records
            </Link>
            <Link href="/jobs/new" className={buttonClassName()}>
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              Create job
            </Link>
          </>
        }
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-4 h-9 w-20" />
              <Skeleton className="mt-3 h-3 w-36" />
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Credential records"
              value={current.totalRecords.toLocaleString()}
              icon={Database}
              tone="brand"
              hint="Total rows currently stored"
            />
            <StatCard
              label="Completed jobs"
              value={current.completedJobs.toLocaleString()}
              icon={CheckCircle2}
              tone="success"
              hint={`Of ${current.totalJobs.toLocaleString()} total jobs`}
            />
            <StatCard
              label="Failed jobs"
              value={current.failedJobs.toLocaleString()}
              icon={XCircle}
              tone="danger"
              hint="Jobs that ended in FAILED state"
            />
            <StatCard
              label="Recent records"
              value={current.recordsAddedRecently.count.toLocaleString()}
              icon={TrendingUp}
              hint={`Added in the last ${windowDays} days`}
            />
          </>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Records by state"
            description="State distribution of stored credential records."
          />
          <CardContent>
            {loading ? (
              <SkeletonText lines={6} />
            ) : (
              <BarList
                items={current.recordsByState.map((item) => ({
                  label: stateName(item.state),
                  meta: item.state,
                  value: item.count,
                }))}
                emptyMessage="No records have been stored yet."
                valueLabel="state records"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Credential type distribution"
            description="Best-effort grouping derived from the stored credential string."
          />
          <CardContent>
            {loading ? (
              <SkeletonText lines={6} />
            ) : (
              <BarList
                items={current.recordsByCredentialType.map((item) => ({
                  label: item.credentialType,
                  value: item.count,
                }))}
                emptyMessage="No credential strings are available yet."
                valueLabel="credential types"
              />
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Recently added records"
          description="The five most recently created records in the database."
          action={
            <Link
              href="/records"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              All records
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="hidden h-4 w-24 sm:block" />
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        ) : recentRecords.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="No credential records yet"
            description="Import records through the backend API to populate this dashboard. Empty states are shown instead of placeholder statistics."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">Name</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Location</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Credential</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Source</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {record.fullName}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {[record.city, record.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      {record.credentialString || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <SourceBadge source={record.source} />
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {formatDate(record.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
