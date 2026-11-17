"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Play,
  Search,
  SkipForward,
  XCircle,
} from "lucide-react";
import {
  ApiClientError,
  describeError,
  getJob,
  runJob,
} from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { CollectionJobDetail } from "@/lib/types";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LogLevelBadge, StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/ui/source-badge";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";

export function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<CollectionJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [running, setRunning] = useState(false);
  const { push } = useToast();

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    if (!job || (job.status !== "PENDING" && job.status !== "RUNNING")) return;

    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [job?.status, reload]);

  async function handleRun() {
    setRunning(true);
    try {
      await runJob(id);
      push({
        tone: "success",
        title: "Collection started",
        description: "Solve the CAPTCHA in the visible Chrome window to continue.",
      });
      reload();
    } catch (caught) {
      push({
        tone: "error",
        title: "Could not start collection",
        description: describeError(caught),
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);
    setNotFound(false);

    getJob(id, controller.signal)
      .then((response) => {
        if (active) setJob(response.data);
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;

        if (caught instanceof ApiClientError && caught.status === 404) {
          setNotFound(true);
          return;
        }

        setError(describeError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, reloadToken]);

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageHeader title="Job not found" description={`No job exists with ID ${id}.`} />
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="This job does not exist"
            description="It may have been removed, or the link may be incorrect."
            action={
              <Link href="/jobs" className={buttonClassName({ variant: "secondary" })}>
                Back to jobs
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Job Details" />
        <ErrorState
          title="Job details unavailable"
          message={error}
          onRetry={reload}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Details"
        description="Recorded status, counters and log entries for one collection job."
        actions={
          <>
            {job && job.status === "PENDING" ? (
              <Button onClick={() => void handleRun()} loading={running}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run Job
              </Button>
            ) : null}
            <Link href="/jobs" className={buttonClassName({ variant: "secondary" })}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to jobs
            </Link>
          </>
        }
      />

      {loading || !job ? (
        <div className="space-y-6">
          <Card className="p-5">
            <Skeleton className="h-5 w-32" />
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <SkeletonText lines={7} />
              <SkeletonText lines={7} />
              <SkeletonText lines={7} />
            </div>
          </Card>
          <Card className="p-5">
            <SkeletonText lines={8} />
          </Card>
        </div>
      ) : (
        <>
          <section
            aria-label="Job counters"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard label="Records found" value={job.recordsFound.toLocaleString()} icon={Search} tone="brand" />
            <StatCard label="Records inserted" value={job.recordsInserted.toLocaleString()} icon={CheckCircle2} tone="success" />
            <StatCard label="Records skipped" value={job.recordsSkipped.toLocaleString()} icon={SkipForward} />
            <StatCard label="Records rejected" value={job.recordsRejected.toLocaleString()} icon={XCircle} tone="danger" />
          </section>

          <Card>
            <CardHeader
              title="Job overview"
              description="Values returned by GET /api/jobs/:id."
              action={<StatusBadge status={job.status} />}
            />
            <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Job ID">
                <div className="flex items-center gap-1">
                  <code className="text-xs text-slate-700" title={job.id}>
                    {job.id}
                  </code>
                  <CopyButton value={job.id} label="Copy ID" />
                </div>
              </Detail>
              <Detail label="Source">
                <SourceBadge source={job.source} />
              </Detail>
              <Detail label="Requested target">
                {job.requestedTarget.toLocaleString()} records
              </Detail>
              <Detail label="Created">{formatDateTime(job.createdAt)}</Detail>
              <Detail label="Started">{formatDateTime(job.startedAt)}</Detail>
              <Detail label="Completed">{formatDateTime(job.completedAt)}</Detail>
              <Detail label="Duration">
                {formatDuration(job.startedAt, job.completedAt)}
              </Detail>
              <Detail label="Last updated">{formatDateTime(job.updatedAt)}</Detail>
              <Detail label="Status">
                <StatusBadge status={job.status} />
              </Detail>
            </CardContent>
          </Card>

          {job.errorMessage ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <p className="font-semibold">Error message</p>
              <p className="mt-1 break-words font-mono text-xs">
                {job.errorMessage}
              </p>
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="Job logs"
              description={`${job.logs.length} log ${job.logs.length === 1 ? "entry" : "entries"} recorded for this job.`}
            />
            {job.logs.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No log entries"
                description="No messages were recorded for this job."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Time
                      </th>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Level
                      </th>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {job.logs.map((log) => (
                      <tr key={log.id} className="align-top">
                        <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-5 py-3">
                          <LogLevelBadge level={log.level} />
                        </td>
                        <td className="px-5 py-3 text-slate-700">
                          <p className="whitespace-pre-wrap break-words font-mono text-xs">
                            {log.message}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}
