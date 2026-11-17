import type {
  CollectionJob,
  CollectionJobDetail,
  CredentialRecord,
  DashboardStats,
  PaginationMeta,
} from "@/lib/types";

export function makeRecord(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Alice Example",
    city: "Los Angeles",
    state: "CA",
    credentialString: "R.T.(R)(CT)",
    source: "ARRT",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

export function makePagination(
  overrides: Partial<PaginationMeta> = {}
): PaginationMeta {
  return {
    page: 1,
    pageSize: 25,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<CollectionJob> = {}): CollectionJob {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "COMPLETED",
    source: "ARRT",
    requestedTarget: 350,
    recordsFound: 400,
    recordsInserted: 350,
    recordsSkipped: 40,
    recordsRejected: 10,
    startedAt: "2026-11-02T10:00:00.000Z",
    completedAt: "2026-11-02T10:01:30.000Z",
    errorMessage: null,
    createdAt: "2026-11-02T09:59:00.000Z",
    updatedAt: "2026-11-02T10:01:30.000Z",
    ...overrides,
  };
}

export function makeJobDetail(
  overrides: Partial<CollectionJobDetail> = {}
): CollectionJobDetail {
  return {
    ...makeJob(),
    logs: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        jobId: "22222222-2222-4222-8222-222222222222",
        level: "INFO",
        message: "Job log started",
        createdAt: "2026-11-02T09:59:01.000Z",
      },
    ],
    ...overrides,
  };
}

export function makeStats(
  overrides: Partial<DashboardStats> = {}
): DashboardStats {
  return {
    totalRecords: 12,
    totalJobs: 5,
    completedJobs: 3,
    failedJobs: 1,
    recordsAddedRecently: {
      windowDays: 30,
      since: "2026-10-18T00:00:00.000Z",
      count: 4,
    },
    recordsByState: [{ state: "CA", count: 8 }],
    recordsByCredentialType: [{ credentialType: "R", count: 12 }],
    ...overrides,
  };
}
