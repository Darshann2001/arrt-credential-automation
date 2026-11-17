import type { JobStatus, LogLevel } from "@/lib/types";
import { JOB_STATUS_LABELS } from "@/lib/constants";
import { Badge } from "./badge";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const STATUS: Record<JobStatus, { tone: Tone; label: string }> = {
  PENDING: { tone: "warning", label: JOB_STATUS_LABELS.PENDING },
  RUNNING: { tone: "info", label: JOB_STATUS_LABELS.RUNNING },
  COMPLETED: { tone: "success", label: JOB_STATUS_LABELS.COMPLETED },
  FAILED: { tone: "danger", label: JOB_STATUS_LABELS.FAILED },
  CANCELLED: { tone: "neutral", label: JOB_STATUS_LABELS.CANCELLED },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = STATUS[status] ?? { tone: "neutral" as const, label: status };

  return (
    <Badge tone={config.tone} dot>
      {config.label}
    </Badge>
  );
}

const LEVEL_TONES: Record<LogLevel, Tone> = {
  DEBUG: "neutral",
  INFO: "info",
  WARN: "warning",
  ERROR: "danger",
};

export function LogLevelBadge({ level }: { level: LogLevel }) {
  return <Badge tone={LEVEL_TONES[level] ?? "neutral"}>{level}</Badge>;
}
