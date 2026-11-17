'use strict';

/**
 * Extraction statistics.
 *
 * Count semantics (also documented in docs/step-2-extraction.md):
 *   totalRows = acceptedCount + rejectedCount + duplicateCount
 *
 * - acceptedCount  rows that produced a valid record.
 * - rejectedCount  rows that failed validation or were structurally malformed.
 * - duplicateCount rows that were valid but matched an earlier record.
 *
 * Duplicates are therefore neither accepted nor rejected. Rows intentionally
 * ignored at the table level (for example a "No results found" row) are
 * reported separately in `ignoredRowCount` and are NOT part of totalRows.
 */

/**
 * @param {object} input
 * @param {object[]} input.pageReports
 * @param {object[]} input.records
 * @param {object[]} input.rejectedRows
 * @param {object[]} input.duplicates
 * @param {object[]} input.ignoredRows
 * @param {number} input.startedAt
 * @returns {object}
 */
function buildStatistics({
  pageReports = [],
  records = [],
  rejectedRows = [],
  duplicates = [],
  ignoredRows = [],
  startedAt = Date.now(),
}) {
  const acceptedCount = records.length;
  const rejectedCount = rejectedRows.length;
  const duplicateCount = duplicates.length;
  const totalRows = acceptedCount + rejectedCount + duplicateCount;

  const primaryErrorsByCode = {};
  const allErrorsByCode = {};
  const duplicateStrategies = {};

  for (const row of rejectedRows) {
    const primary = row.code || 'ROW_REJECTED';
    primaryErrorsByCode[primary] = (primaryErrorsByCode[primary] || 0) + 1;

    for (const error of row.errors || []) {
      allErrorsByCode[error.code] = (allErrorsByCode[error.code] || 0) + 1;
    }
  }

  for (const duplicate of duplicates) {
    const strategy = duplicate.strategy || 'unknown';
    duplicateStrategies[strategy] = (duplicateStrategies[strategy] || 0) + 1;
  }

  return {
    pagesProcessed: pageReports.length,
    candidateRows: totalRows,
    totalRows,
    acceptedCount,
    rejectedCount,
    duplicateCount,
    ignoredRowCount: ignoredRows.length,
    countsConsistent:
      totalRows === acceptedCount + rejectedCount + duplicateCount,
    acceptanceRate: ratio(acceptedCount, totalRows),
    rejectionRate: ratio(rejectedCount, totalRows),
    duplicateRate: ratio(duplicateCount, totalRows),
    primaryErrorsByCode,
    allErrorsByCode,
    duplicateStrategies,
    duplicates: duplicates.map(summarizeDuplicate),
    pages: pageReports,
    ignoredRows,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function summarizeDuplicate(duplicate) {
  const record = duplicate.record || {};
  const source = record.source || {};

  return {
    key: duplicate.key || null,
    strategy: duplicate.strategy || null,
    page: source.page ?? null,
    rowNumber: source.rowNumber ?? null,
    recordId: record.recordId ?? null,
    fullName: record.fullName ?? null,
    duplicateOf: duplicate.duplicateOf || null,
  };
}

function ratio(part, total) {
  return total === 0 ? 0 : part / total;
}

module.exports = {
  buildStatistics,
};
