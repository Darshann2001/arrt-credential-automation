import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordsExplorer } from "@/components/records/records-explorer";
import { ToastProvider } from "@/components/ui/toast";
import { getAllRecords, getRecords } from "@/lib/api";
import { makePagination, makeRecord } from "./fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getRecords: vi.fn(),
    getAllRecords: vi.fn(),
  };
});

const mockedGetRecords = vi.mocked(getRecords);
const mockedGetAllRecords = vi.mocked(getAllRecords);

function renderExplorer() {
  return render(
    <ToastProvider>
      <RecordsExplorer />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetRecords.mockResolvedValue({
    data: [makeRecord()],
    pagination: makePagination({
      total: 3,
      totalPages: 2,
      hasNextPage: true,
    }),
  });
  mockedGetAllRecords.mockResolvedValue({
    records: [makeRecord()],
    total: 1,
    truncated: false,
  });
});

describe("RecordsExplorer", () => {
  it("loads and renders records from the API", async () => {
    renderExplorer();

    expect(await screen.findByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("R.T.(R)(CT)")).toBeInTheDocument();
    expect(mockedGetRecords).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25 }),
      expect.anything()
    );
  });

  it("sends debounced search and sort changes to the API", async () => {
    renderExplorer();
    await screen.findByText("Alice Example");

    fireEvent.change(screen.getByLabelText("Search name"), {
      target: { value: "Alice" },
    });

    await waitFor(
      () =>
        expect(mockedGetRecords).toHaveBeenCalledWith(
          expect.objectContaining({ search: "Alice" }),
          expect.anything()
        ),
      { timeout: 2000 }
    );

    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "fullName:asc" },
    });

    await waitFor(() =>
      expect(mockedGetRecords).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "fullName", sortOrder: "asc" }),
        expect.anything()
      )
    );
  });

  it("requests the next page from the server", async () => {
    renderExplorer();
    await screen.findByText("Alice Example");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(mockedGetRecords).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.anything()
      )
    );
  });

  it("exports all matching records to CSV", async () => {
    const createObjectURL = vi.fn(() => "blob:arrt-export");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    renderExplorer();
    await screen.findByText("Alice Example");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(mockedGetAllRecords).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(await screen.findByText(/Exported 1 rows/)).toBeInTheDocument();
  });
});
