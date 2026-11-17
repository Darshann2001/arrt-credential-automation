import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDashboardStats, getRecords } from "@/lib/api";
import { makePagination, makeRecord, makeStats } from "./fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getDashboardStats: vi.fn(),
    getRecords: vi.fn(),
  };
});

const mockedGetStats = vi.mocked(getDashboardStats);
const mockedGetRecords = vi.mocked(getRecords);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetStats.mockResolvedValue({ data: makeStats() });
  mockedGetRecords.mockResolvedValue({
    data: [makeRecord({ source: "DEMO" })],
    pagination: makePagination(),
  });
});

describe("Dashboard", () => {
  it("renders live statistics, distributions and recent records", async () => {
    render(<Dashboard />);

    expect((await screen.findAllByText("12")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByText("California")).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(mockedGetStats).toHaveBeenCalledWith(30, expect.anything());
  });

  it("shows an empty state for an empty database", async () => {
    mockedGetStats.mockResolvedValue({
      data: makeStats({
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
      }),
    });
    mockedGetRecords.mockResolvedValue({
      data: [],
      pagination: makePagination({ total: 0, totalPages: 0 }),
    });

    render(<Dashboard />);

    expect(
      await screen.findByText("No credential records yet")
    ).toBeInTheDocument();
    expect(screen.getByText("No records have been stored yet.")).toBeInTheDocument();
  });
});
