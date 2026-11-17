import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobDetail } from "@/components/jobs/job-detail";
import { ToastProvider } from "@/components/ui/toast";
import { ApiClientError, getJob } from "@/lib/api";
import { makeJobDetail } from "./fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getJob: vi.fn(),
  };
});

const mockedGetJob = vi.mocked(getJob);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetJob.mockResolvedValue({ data: makeJobDetail() });
});

describe("JobDetail", () => {
  it("renders counters, job metadata and logs", async () => {
    render(
      <ToastProvider>
        <JobDetail id="job-123" />
      </ToastProvider>
    );

    expect(await screen.findByText("Job log started")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("1m 30s")).toBeInTheDocument();
    expect(screen.getByText(/350 records/)).toBeInTheDocument();
    expect(mockedGetJob).toHaveBeenCalledWith("job-123", expect.anything());
  });

  it("shows a not-found state for a 404 response", async () => {
    mockedGetJob.mockRejectedValue(
      new ApiClientError(404, "NOT_FOUND", "Job not found.")
    );

    render(
      <ToastProvider>
        <JobDetail id="missing" />
      </ToastProvider>
    );

    expect(await screen.findByText("This job does not exist")).toBeInTheDocument();
  });
});
