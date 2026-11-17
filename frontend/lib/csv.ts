import { CSV_COLUMNS } from "./constants";
import type { CredentialRecord } from "./types";

/**
 * Serializes records to CSV.
 *
 * Cells that start with a spreadsheet formula character are prefixed with an
 * apostrophe so exported data cannot execute as a formula in Excel/Sheets.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function recordsToCsv(records: CredentialRecord[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = records.map((record) =>
    CSV_COLUMNS.map((column) => escapeCsvCell(record[column])).join(",")
  );

  return `${[header, ...rows].join("\r\n")}\r\n`;
}

export function csvFilename(prefix = "arrt-credential-records"): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") {
    return;
  }

  // BOM keeps Excel from misreading UTF-8 names.
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
