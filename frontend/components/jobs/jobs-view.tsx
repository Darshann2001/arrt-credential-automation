"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlusCircle, RefreshCw } from "lucide-react";
import { API_BASE_URL, describeError, getJobs } from "@/lib/api";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/constants";
import type { CollectionJob, JobStatus, PaginationMeta } from "@/lib/types";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { JobsTable } from "./jobs-table";

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export function JobsView() {
  const [status, setStatus] = useState<JobStatus | "">("");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    getJobs({ page, pageSize: 25, status: status || undefined }, controller.signal)
      .then((response) => {
        if (!active) return;
        setJobs(response.data);
        setPagination(response.pagination);

        if (page > Math.max(response.pagination.totalPages, 1)) {
          setPage(1);
        }
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
  }, [page, status, reloadToken]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collection Jobs"
        description="Job history and counters recorded by the API. Creating a job stores intent only; it does not start live collection."
        actions={
          <Link href="/jobs/new" className={buttonClassName()}>
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create job
          </Link>
        }
      />

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Select
            label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as JobStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {JOB_STATUSES.map((item) => (
              <option key={item} value={item}>
                {JOB_STATUS_LABELS[item]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-400">API: {API_BASE_URL}/api/jobs</p>
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`${pagination.total.toLocaleString()} jobs`}
          description="Counters are recorded by the backend. A PENDING job has not contacted ARRT."
        />

        {error ? (
          <div className="p-5">
            <ErrorState
              title="Jobs could not be loaded"
              message={error}
              onRetry={reload}
            />
          </div>
        ) : !loading && jobs.length === 0 ? (
          <EmptyState
            title={status ? `No ${JOB_STATUS_LABELS[status]} jobs` : "No collection jobs yet"}
            description={
              status
                ? "Try another status filter or clear it to see the full history."
                : "Jobs appear here after they are created through the API or this dashboard."
            }
            action={
              status ? (
                <Button variant="secondary" onClick={() => { setStatus(""); setPage(1); }}>
                  Show all jobs
                </Button>
              ) : (
                <Link href="/jobs/new" className={buttonClassName()}>
                  Create a pending job
                </Link>
              )
            }
          />
        ) : (
          <>
            <JobsTable jobs={jobs} loading={loading} />
            <Pagination
              pagination={pagination}
              onPageChange={setPage}
              itemLabel="jobs"
              disabled={loading}
            />
          </>
        )}
      </Card>
    </div>
  );
}
