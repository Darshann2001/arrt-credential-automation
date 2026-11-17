import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateJobForm } from "@/components/jobs/create-job-form";
import { ToastProvider } from "@/components/ui/toast";
import { createJob } from "@/lib/api";
import { makeJob } from "./fixtures";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createJob: vi.fn(),
  };
});

const mockedCreateJob = vi.mocked(createJob);

function renderForm() {
  return render(
    <ToastProvider>
      <CreateJobForm />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateJob.mockResolvedValue({ data: makeJob() });
});

describe("CreateJobForm", () => {
  it("states clearly that no live collection is started", () => {
    renderForm();

    expect(
      screen.getByText("Creating a job does not start live ARRT collection.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/unattended collection is not available/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create pending job" })
    ).toBeInTheDocument();
  });

  it("validates the requested target before calling the API", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Requested target"), {
      target: { value: "100001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pending job" }));

    expect(
      await screen.findByText("Requested target must be 100,000 or less.")
    ).toBeInTheDocument();
    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("creates a pending job through POST /api/jobs", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Create pending job" }));

    await waitFor(() =>
      expect(mockedCreateJob).toHaveBeenCalledWith({
        requestedTarget: 350,
        source: "ARRT",
      })
    );
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(`/jobs/${makeJob().id}`)
    );
  });
});
