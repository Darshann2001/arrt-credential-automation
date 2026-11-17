import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JobsView } from "@/components/jobs/jobs-view";
import { getJobs } from "@/lib/api";
import { makeJob, makePagination } from "./fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getJobs: vi.fn(),
  };
});

const mockedGetJobs = vi.mocked(getJobs);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetJobs.mockResolvedValue({
    data: [makeJob()],
    pagination: makePagination({ total: 1, totalPages: 1 }),
  });
});

describe("JobsView", () => {
  it("renders job history with counters and status", async () => {
    render(<JobsView />);

    expect(await screen.findByText("22222222…")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("350")[0]).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create job" })).toHaveAttribute(
      "href",
      "/jobs/new"
    );
  });

  it("filters job history by status", async () => {
    render(<JobsView />);
    await screen.findByText("22222222…");

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "FAILED" },
    });

    await waitFor(() =>
      expect(mockedGetJobs).toHaveBeenCalledWith(
        expect.objectContaining({ status: "FAILED", page: 1 }),
        expect.anything()
      )
    );
  });

  it("shows an empty state when no jobs exist", async () => {
    mockedGetJobs.mockResolvedValue({
      data: [],
      pagination: makePagination({ total: 0, totalPages: 0 }),
    });

    render(<JobsView />);

    expect(await screen.findByText("No collection jobs yet")).toBeInTheDocument();
  });
});
