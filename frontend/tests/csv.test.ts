import { describe, expect, it } from "vitest";
import { escapeCsvCell, recordsToCsv } from "@/lib/csv";
import { makeRecord } from "./fixtures";

describe("CSV export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(escapeCsvCell('Smith, "Jane"')).toBe('"Smith, ""Jane"""');
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell("+123")).toBe("'+123");
  });

  it("writes the API record fields as CSV columns", () => {
    const csv = recordsToCsv([
      makeRecord({
        fullName: "Doe, Jane",
        state: "NY",
        credentialString: "RT-123",
        source: "DEMO",
      }),
    ]);

    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "id,fullName,city,state,credentialString,source,createdAt"
    );
    expect(lines[1]).toContain('"Doe, Jane"');
    expect(lines[1]).toContain("DEMO");
  });
});
