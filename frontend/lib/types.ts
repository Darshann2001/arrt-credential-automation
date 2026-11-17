/**
 * API response types.
 *
 * These mirror the Express API exactly:
 * - lists return `{ data, pagination }`
 * - single resources return `{ data }`
 * - errors return `{ error: { code, message, details? }, requestId }`
 */

export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type SortOrder = "asc" | "desc";

export type RecordSortField =
  | "createdAt"
  | "updatedAt"
  | "fullName"
  | "city"
  | "state"
  | "credentialString";

export interface CredentialRecord {
  id: string;
  fullName: string;
  city: string;
  state: string;
  credentialString: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface SingleResponse<T> {
  data: T;
}

export interface RecordsByState {
  state: string;
  count: number;
}

export interface RecordsByCredentialType {
  credentialType: string;
  count: number;
}

export interface DashboardStats {
  totalRecords: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  recordsAddedRecently: {
    windowDays: number;
    since: string;
    count: number;
  };
  recordsByState: RecordsByState[];
  recordsByCredentialType: RecordsByCredentialType[];
}

export interface CollectionJob {
  id: string;
  status: JobStatus;
  source: string;
  requestedTarget: number;
  recordsFound: number;
  recordsInserted: number;
  recordsSkipped: number;
  recordsRejected: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionJobLog {
  id: string;
  jobId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface CollectionJobDetail extends CollectionJob {
  logs: CollectionJobLog[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  database: string;
  uptimeSeconds: number;
  latencyMs: number;
  timestamp: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string | null;
}
