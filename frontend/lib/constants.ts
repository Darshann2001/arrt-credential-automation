import type { CredentialRecord, JobStatus, RecordSortField, SortOrder } from "./types";

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const STATE_NAMES = new Map(US_STATES.map((state) => [state.code, state.name]));

export function stateName(code: string): string {
  const normalized = code.trim().toUpperCase();
  return STATE_NAMES.get(normalized) ?? code;
}

export const JOB_STATUSES: JobStatus[] = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export interface SortOption {
  value: string;
  label: string;
  sortBy: RecordSortField;
  sortOrder: SortOrder;
}

export const RECORD_SORT_OPTIONS: SortOption[] = [
  {
    value: "createdAt:desc",
    label: "Newest first",
    sortBy: "createdAt",
    sortOrder: "desc",
  },
  {
    value: "createdAt:asc",
    label: "Oldest first",
    sortBy: "createdAt",
    sortOrder: "asc",
  },
  {
    value: "fullName:asc",
    label: "Name A–Z",
    sortBy: "fullName",
    sortOrder: "asc",
  },
  {
    value: "fullName:desc",
    label: "Name Z–A",
    sortBy: "fullName",
    sortOrder: "desc",
  },
  {
    value: "state:asc",
    label: "State A–Z",
    sortBy: "state",
    sortOrder: "asc",
  },
  {
    value: "city:asc",
    label: "City A–Z",
    sortBy: "city",
    sortOrder: "asc",
  },
  {
    value: "credentialString:asc",
    label: "Credential A–Z",
    sortBy: "credentialString",
    sortOrder: "asc",
  },
];

export function sortOptionValue(
  sortBy: RecordSortField,
  sortOrder: SortOrder
): string {
  return `${sortBy}:${sortOrder}`;
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

export const DEFAULT_REQUESTED_TARGET = 350;

const DEMO_SOURCES = new Set(["DEMO", "SEED", "FIXTURE", "SAMPLE", "TEST"]);

export function isDemoSource(source: string | null | undefined): boolean {
  return DEMO_SOURCES.has(String(source ?? "").trim().toUpperCase());
}

export const CSV_COLUMNS: (keyof CredentialRecord)[] = [
  "id",
  "fullName",
  "city",
  "state",
  "credentialString",
  "source",
  "createdAt",
];
