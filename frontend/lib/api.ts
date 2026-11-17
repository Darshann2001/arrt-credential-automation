import type {
  CollectionJob,
  CollectionJobDetail,
  CredentialRecord,
  DashboardStats,
  HealthStatus,
  JobStatus,
  ListResponse,
  RecordSortField,
  SingleResponse,
  SortOrder,
} from "./types";

const DEFAULT_API_URL = "http://localhost:4000";
const REQUEST_TIMEOUT_MS = 20_000;

export const EXPORT_PAGE_SIZE = 200;
export const EXPORT_LIMIT = 10_000;

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL
).replace(/\/+$/, "");

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; requestId?: string | null } = {}
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.requestId = options.requestId ?? null;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

/**
 * Extracts `{ path, message }` validation issues from an API error payload so
 * forms can show them under the matching field.
 */
export function extractFieldErrors(details: unknown): Record<string, string> {
  const output: Record<string, string> = {};

  if (!details || typeof details !== "object") {
    return output;
  }

  const fields = (details as { fields?: unknown }).fields;

  if (!Array.isArray(fields)) {
    return output;
  }

  for (const entry of fields) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const path = (entry as { path?: unknown }).path;
    const message = (entry as { message?: unknown }).message;

    if (typeof path === "string" && typeof message === "string") {
      output[path] = message;
    }
  }

  return output;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error;
    }

    throw new ApiClientError(
      0,
      "NETWORK_ERROR",
      `Cannot reach the API at ${API_BASE_URL}. Make sure the backend is running and NEXT_PUBLIC_API_URL is correct.`
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = payload as
      | { error?: { code?: unknown; message?: unknown; details?: unknown } }
      | null;

    const code =
      typeof body?.error?.code === "string" ? body.error.code : "HTTP_ERROR";
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `Request failed with status ${response.status}.`;

    throw new ApiClientError(response.status, code, message, {
      details: body?.error?.details,
      requestId: response.headers.get("x-request-id"),
    });
  }

  return payload as T;
}

export interface RecordListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  state?: string;
  city?: string;
  credential?: string;
  sortBy?: RecordSortField;
  sortOrder?: SortOrder;
}

export type RecordFilters = Omit<RecordListParams, "page" | "pageSize">;

function buildQuery(
  values: Record<string, string | number | undefined | null>
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();

    if (text) {
      params.set(key, text);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getRecords(
  params: RecordListParams = {},
  signal?: AbortSignal
): Promise<ListResponse<CredentialRecord>> {
  const query = buildQuery({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    state: params.state,
    city: params.city,
    credential: params.credential,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });

  return request<ListResponse<CredentialRecord>>(`/api/records${query}`, {
    signal,
  });
}

/**
 * Fetches every record matching the filters for CSV export, capped at
 * EXPORT_LIMIT. The API caps pageSize at 200, so this pages sequentially.
 */
export async function getAllRecords(
  filters: RecordFilters = {},
  signal?: AbortSignal
): Promise<{
  records: CredentialRecord[];
  total: number;
  truncated: boolean;
}> {
  const records: CredentialRecord[] = [];
  let page = 1;
  let total = 0;

  while (records.length < EXPORT_LIMIT) {
    const pageSize = Math.min(EXPORT_PAGE_SIZE, EXPORT_LIMIT - records.length);
    const result = await getRecords(
      { ...filters, page, pageSize },
      signal
    );

    total = result.pagination.total;
    records.push(...result.data);

    if (
      result.data.length === 0 ||
      records.length >= total ||
      !result.pagination.hasNextPage
    ) {
      break;
    }

    page += 1;
  }

  return {
    records,
    total,
    truncated: total > records.length,
  };
}

export function getDashboardStats(
  recentDays = 30,
  signal?: AbortSignal
): Promise<SingleResponse<DashboardStats>> {
  return request<SingleResponse<DashboardStats>>(
    `/api/dashboard/stats${buildQuery({ recentDays })}`,
    { signal }
  );
}

export interface JobListParams {
  page?: number;
  pageSize?: number;
  status?: JobStatus;
}

export function getJobs(
  params: JobListParams = {},
  signal?: AbortSignal
): Promise<ListResponse<CollectionJob>> {
  const query = buildQuery({
    page: params.page,
    pageSize: params.pageSize,
    status: params.status,
  });

  return request<ListResponse<CollectionJob>>(`/api/jobs${query}`, { signal });
}

export function getJob(
  id: string,
  signal?: AbortSignal
): Promise<SingleResponse<CollectionJobDetail>> {
  return request<SingleResponse<CollectionJobDetail>>(
    `/api/jobs/${encodeURIComponent(id)}`,
    { signal }
  );
}

export interface CreateJobInput {
  requestedTarget: number;
  source: string;
}

export function createJob(
  input: CreateJobInput
): Promise<SingleResponse<CollectionJob>> {
  return request<SingleResponse<CollectionJob>>("/api/jobs", {
    method: "POST",
    body: input,
  });
}

export function runJob(
  id: string
): Promise<SingleResponse<CollectionJob>> {
  return request<SingleResponse<CollectionJob>>(
    `/api/jobs/${encodeURIComponent(id)}/run`,
    { method: "POST" }
  );
}

export function getHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return request<HealthStatus>("/api/health", { signal });
}
