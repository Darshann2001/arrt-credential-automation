import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL,
  ApiClientError,
  getAllRecords,
  getJobs,
  getRecords,
} from "@/lib/api";
import { makePagination, makeRecord } from "./fixtures";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers as Record<string, string> | undefined),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("API client", () => {
  it("builds filter query parameters and parses a list response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [makeRecord()],
        pagination: makePagination(),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getRecords({
      page: 2,
      pageSize: 50,
      search: "Alice",
      state: "CA",
      city: "Los Angeles",
      credential: "R.T.",
      sortBy: "fullName",
      sortOrder: "asc",
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith(`${API_BASE_URL}/api/records?`)).toBe(true);
    expect(url).toContain("page=2");
    expect(url).toContain("pageSize=50");
    expect(url).toContain("search=Alice");
    expect(url).toContain("state=CA");
    expect(url).toContain("city=Los+Angeles");
    expect(url).toContain("credential=R.T.");
    expect(url).toContain("sortBy=fullName");
    expect(url).toContain("sortOrder=asc");
  });

  it("maps API error payloads to ApiClientError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: { code: "VALIDATION_ERROR", message: "Invalid request." },
            requestId: "req-123",
          },
          400,
          { "x-request-id": "req-123" }
        )
      )
    );

    await expect(getJobs()).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
      requestId: "req-123",
    });
  });

  it("maps connection failures to a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(getJobs()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("pages through all records for CSV export", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [makeRecord({ id: "a" }), makeRecord({ id: "b" })],
          pagination: makePagination({
            page: 1,
            pageSize: 200,
            total: 3,
            totalPages: 2,
            hasNextPage: true,
          }),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [makeRecord({ id: "c" })],
          pagination: makePagination({
            page: 2,
            pageSize: 200,
            total: 3,
            totalPages: 2,
            hasPreviousPage: true,
          }),
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAllRecords({ state: "CA" });

    expect(result.records.map((record) => record.id)).toEqual(["a", "b", "c"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("exports error details from a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request.",
              details: {
                fields: [{ path: "requestedTarget", message: "Too large." }],
              },
            },
          },
          400
        )
      )
    );

    await expect(getJobs()).rejects.toBeInstanceOf(ApiClientError);
  });
});
