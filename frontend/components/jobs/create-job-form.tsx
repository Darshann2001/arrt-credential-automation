"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Info, PlusCircle } from "lucide-react";
import {
  ApiClientError,
  createJob,
  describeError,
  extractFieldErrors,
} from "@/lib/api";
import { DEFAULT_REQUESTED_TARGET } from "@/lib/constants";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

type FieldName = "requestedTarget" | "source";
type FormErrors = Partial<Record<FieldName, string>>;

const MAX_TARGET = 100_000;
const MAX_SOURCE_LENGTH = 50;

function validate(values: { requestedTarget: string; source: string }): FormErrors {
  const errors: FormErrors = {};
  const target = values.requestedTarget.trim();
  const source = values.source.trim();

  if (!target) {
    errors.requestedTarget = "Requested target is required.";
  } else if (!/^\d+$/.test(target)) {
    errors.requestedTarget = "Requested target must be a whole number.";
  } else {
    const parsed = Number(target);

    if (!Number.isSafeInteger(parsed)) {
      errors.requestedTarget = "Requested target must be a valid whole number.";
    } else if (parsed < 0) {
      errors.requestedTarget = "Requested target must be zero or greater.";
    } else if (parsed > MAX_TARGET) {
      errors.requestedTarget = `Requested target must be ${MAX_TARGET.toLocaleString()} or less.`;
    }
  }

  if (!source) {
    errors.source = "Source is required.";
  } else if (source.length > MAX_SOURCE_LENGTH) {
    errors.source = `Source must be ${MAX_SOURCE_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function CreateJobForm() {
  const router = useRouter();
  const { push } = useToast();

  const [requestedTarget, setRequestedTarget] = useState(
    String(DEFAULT_REQUESTED_TARGET)
  );
  const [source, setSource] = useState("ARRT");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validate({ requestedTarget, source });
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      push({
        tone: "error",
        title: "Check the form",
        description: "Fix the highlighted fields before creating the job.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const response = await createJob({
        requestedTarget: Number(requestedTarget.trim()),
        source: source.trim(),
      });

      push({
        tone: "success",
        title: "Pending job created",
        description:
          "The job was stored with PENDING status and an INFO log. No live ARRT collection was started.",
      });

      router.push(`/jobs/${response.data.id}`);
    } catch (caught) {
      const details = caught instanceof ApiClientError ? caught.details : undefined;
      const fieldErrors = extractFieldErrors(details);
      const next: FormErrors = {};

      if (typeof fieldErrors.requestedTarget === "string") {
        next.requestedTarget = fieldErrors.requestedTarget;
      }

      if (typeof fieldErrors.source === "string") {
        next.source = fieldErrors.source;
      }

      setErrors(next);

      push({
        tone: "error",
        title: "Job could not be created",
        description:
          Object.keys(next).length > 0
            ? "The API rejected one or more fields. Check the highlighted values."
            : describeError(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Collection Job"
        description="Record a job request in the database. This action does not run the ARRT automation."
        actions={
          <Link href="/jobs" className={buttonClassName({ variant: "secondary" })}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to jobs
          </Link>
        }
      />

      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">
            Creating a job does not start live ARRT collection.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            POST /api/jobs stores a PENDING job and an INFO log entry only. No
            browser is launched, no request is sent to ARRT, and unattended
            collection is not available. Counters stay at zero until a separate
            collection process updates the job.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Job request"
            description="Both fields are validated locally and again by the API."
          />
          <CardContent>
            <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
              <Input
                label="Requested target"
                name="requestedTarget"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_TARGET}
                step={1}
                value={requestedTarget}
                error={errors.requestedTarget}
                hint={`Maximum ${MAX_TARGET.toLocaleString()} records. The API default is ${DEFAULT_REQUESTED_TARGET}.`}
                onChange={(event) => {
                  setRequestedTarget(event.target.value);
                  if (errors.requestedTarget) {
                    setErrors((current) => ({ ...current, requestedTarget: undefined }));
                  }
                }}
              />

              <Input
                label="Source"
                name="source"
                value={source}
                maxLength={MAX_SOURCE_LENGTH}
                error={errors.source}
                hint="A short label stored with the job. Use ARRT for the standard source label."
                onChange={(event) => {
                  setSource(event.target.value);
                  if (errors.source) {
                    setErrors((current) => ({ ...current, source: undefined }));
                  }
                }}
              />

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Info className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  The new job will be created with status PENDING.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/jobs"
                    className={buttonClassName({ variant: "secondary" })}
                  >
                    Cancel
                  </Link>
                  <Button type="submit" loading={submitting}>
                    <PlusCircle className="h-4 w-4" aria-hidden="true" />
                    Create pending job
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="What happens next"
            description="After creating the job, open its detail page and click Run Job."
          />
          <CardContent className="space-y-4 text-sm text-slate-600">
            <div>
              <p className="font-medium text-slate-900">1. Request is stored</p>
              <p className="mt-1 text-sm text-slate-500">
                The API inserts the job and its first INFO log in one transaction.
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-900">2. Click Run Job on the detail page</p>
              <p className="mt-1 text-sm text-slate-500">
                Nothing starts until you explicitly click Run Job. Chrome opens visibly and you solve the CAPTCHA yourself.
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-900">3. Job history is visible</p>
              <p className="mt-1 text-sm text-slate-500">
                The job appears in Collection Jobs and its detail page with zeroed
                counters.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
