'use strict';

/**
 * Fixture-driven HTML extraction service.
 *
 * This module never fetches remote content and never interacts with ARRT. It
 * loads local/inline HTML, locates a results table by its headers, maps columns
 * by header label, normalizes and validates each row, and reports accepted,
 * rejected and duplicate rows with provenance.
 */

const { ALL_FIELDS, EXTRACTED_FIELDS } = require('./fields');
const { ExtractionError, EXTRACTION_CODES } = require('./errors');
const { loadPages } = require('./html-loader');
const { parseHtml } = require('./dom-parser');
const { locateResultsTable } = require('./table-locator');
const { extractRows } = require('./row-extractor');
const { normalizeRecordValues } = require('./field-normalizer');
const { validateRecordValues } = require('./field-validator');
const {
  buildRecord,
  buildRejectedRow,
  buildMalformedRejection,
} = require('./record-builder');
const { createDuplicateTracker } = require('./duplicate-detector');
const { buildStatistics } = require('./statistics');

const DEFAULT_MAX_ROWS = 10000;
const DEFAULT_REQUIRED_HEADERS = Object.freeze(['fullName']);

const EXTRACTION_OPTION_KEYS = Object.freeze([
  'maxBytes',
  'maxPages',
  'maxRows',
  'tableSelector',
  'aliases',
  'requiredHeaders',
  'noResultsPattern',
  'dedupe',
]);

/**
 * Extracts result records from one or more local HTML pages.
 *
 * @param {unknown} input Page source(s): HTML string, fixture path, page object,
 *   or `{ pages: [...] }`.
 * @param {object} [options]
 * @param {number} [options.maxBytes=2097152]
 * @param {number} [options.maxPages=100]
 * @param {number} [options.maxRows=10000]
 * @param {string|null} [options.tableSelector]
 * @param {object} [options.aliases]
 * @param {string[]} [options.requiredHeaders=['fullName']]
 * @param {RegExp} [options.noResultsPattern]
 * @param {boolean} [options.dedupe=true]
 * @returns {{
 *   totalRows: number,
 *   acceptedCount: number,
 *   rejectedCount: number,
 *   duplicateCount: number,
 *   records: object[],
 *   rejectedRows: object[],
 *   stats: object
 * }}
 */
function extractRecords(input, options) {
  const resolvedOptions = normalizeExtractionOptions(options);
  const startedAt = Date.now();

  const {
    maxBytes,
    maxPages,
    maxRows = DEFAULT_MAX_ROWS,
    tableSelector = null,
    aliases,
    requiredHeaders = DEFAULT_REQUIRED_HEADERS,
    noResultsPattern,
    dedupe = true,
  } = resolvedOptions;

  const pages = loadPages(input, { maxBytes, maxPages });

  const records = [];
  const rejectedRows = [];
  const duplicates = [];
  const ignoredRows = [];
  const pageReports = [];
  const duplicateTracker = createDuplicateTracker();

  let consideredRows = 0;

  for (const pageSource of pages) {
    const $ = parseHtml(pageSource.html, pageSource);

    let tableInfo;
    try {
      tableInfo = locateResultsTable($, {
        tableSelector,
        aliases,
        requiredFields: requiredHeaders,
      });
    } catch (error) {
      annotatePageContext(error, pageSource);
      throw error;
    }

    const { rows, ignored } = extractRows($, tableInfo, {
      page: pageSource.page,
      fixture: pageSource.fixture,
      sourceUrl: pageSource.sourceUrl,
      noResultsPattern,
      aliases,
    });

    const report = {
      page: pageSource.page,
      fixture: pageSource.fixture,
      sourceUrl: pageSource.sourceUrl,
      tableIndex: tableInfo.tableIndex,
      headers: tableInfo.headerLabels,
      columns: tableInfo.columns,
      columnLabels: tableInfo.columnLabels,
      duplicateHeaders: tableInfo.duplicateHeaders,
      candidateRows: rows.length,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      ignoredCount: ignored.length,
    };

    for (const ignoredRow of ignored) {
      ignoredRows.push(ignoredRow);
    }

    for (const row of rows) {
      consideredRows += 1;

      if (consideredRows > maxRows) {
        throw new ExtractionError(
          `Extraction exceeded maxRows (${maxRows}) at page ${pageSource.page} row ${row.provenance.rowNumber}.`,
          {
            code: EXTRACTION_CODES.ROW_LIMIT_EXCEEDED,
            page: pageSource.page,
            fixture: pageSource.fixture,
            row: row.provenance.rowNumber,
            details: { maxRows },
          }
        );
      }

      if (row.malformed) {
        rejectedRows.push(
          buildMalformedRejection(row.malformed, {
            rawValues: row.values,
            provenance: row.provenance,
          })
        );
        report.rejectedCount += 1;
        continue;
      }

      const normalized = normalizeRecordValues({
        ...row.values,
        recordId: row.recordId,
      });
      const errors = validateRecordValues(normalized);

      if (errors.length > 0) {
        rejectedRows.push(
          buildRejectedRow(errors, {
            rawValues: row.values,
            values: normalized,
            provenance: row.provenance,
            recordId: row.recordId,
          })
        );
        report.rejectedCount += 1;
        continue;
      }

      const record = buildRecord(
        normalized,
        row.provenance,
        row.recordId || normalized.recordId
      );

      if (dedupe) {
        const result = duplicateTracker.check(record);

        if (result.duplicate) {
          duplicates.push({
            key: result.key,
            strategy: result.strategy,
            record,
            duplicateOf: {
              page: result.first.source.page,
              rowNumber: result.first.source.rowNumber,
              recordId: result.first.recordId,
            },
          });
          report.duplicateCount += 1;
          continue;
        }
      }

      records.push(record);
      report.acceptedCount += 1;
    }

    pageReports.push(report);
  }

  const stats = buildStatistics({
    pageReports,
    records,
    rejectedRows,
    duplicates,
    ignoredRows,
    startedAt,
  });

  return {
    totalRows: stats.totalRows,
    acceptedCount: records.length,
    rejectedCount: rejectedRows.length,
    duplicateCount: duplicates.length,
    records,
    rejectedRows,
    stats,
  };
}

function normalizeExtractionOptions(options) {
  if (options === undefined) {
    return {};
  }

  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ExtractionError(
      `extractRecords options must be a plain object, received ${describeValue(
        options
      )}.`,
      {
        code: EXTRACTION_CODES.INVALID_OPTIONS,
        field: 'options',
        value: options,
      }
    );
  }

  const unknownKeys = Object.keys(options).filter(
    (key) => !EXTRACTION_OPTION_KEYS.includes(key)
  );

  if (unknownKeys.length > 0) {
    throw new ExtractionError(
      `extractRecords received unknown option(s): ${unknownKeys.join(
        ', '
      )}. Allowed options: ${EXTRACTION_OPTION_KEYS.join(', ')}.`,
      {
        code: EXTRACTION_CODES.INVALID_OPTIONS,
        field: 'options',
        details: { unknownKeys },
      }
    );
  }

  assertPositiveInteger(options.maxBytes, 'maxBytes');
  assertPositiveInteger(options.maxPages, 'maxPages');
  assertPositiveInteger(options.maxRows, 'maxRows');

  if (
    options.tableSelector !== undefined &&
    options.tableSelector !== null &&
    typeof options.tableSelector !== 'string'
  ) {
    throw invalidOption(
      'tableSelector',
      'must be a string or null',
      options.tableSelector
    );
  }

  if (
    options.aliases !== undefined &&
    (options.aliases === null ||
      typeof options.aliases !== 'object' ||
      Array.isArray(options.aliases))
  ) {
    throw invalidOption(
      'aliases',
      'must be a plain object mapping field names to alias arrays',
      options.aliases
    );
  }

  if (options.noResultsPattern !== undefined) {
    if (!(options.noResultsPattern instanceof RegExp)) {
      throw invalidOption(
        'noResultsPattern',
        'must be a RegExp',
        options.noResultsPattern
      );
    }
  }

  if (options.dedupe !== undefined && typeof options.dedupe !== 'boolean') {
    throw invalidOption('dedupe', 'must be a boolean', options.dedupe);
  }

  if (options.requiredHeaders !== undefined) {
    if (
      !Array.isArray(options.requiredHeaders) ||
      options.requiredHeaders.length === 0
    ) {
      throw invalidOption(
        'requiredHeaders',
        'must be a non-empty array of field names',
        options.requiredHeaders
      );
    }

    const invalid = options.requiredHeaders.filter(
      (field) => !ALL_FIELDS.includes(field)
    );

    if (invalid.length > 0) {
      throw invalidOption(
        'requiredHeaders',
        `contains unsupported field name(s): ${invalid.join(
          ', '
        )}. Supported: ${ALL_FIELDS.join(', ')}`,
        options.requiredHeaders
      );
    }
  }

  return options;
}

function assertPositiveInteger(value, name) {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw invalidOption(name, 'must be a positive integer', value);
  }
}

function invalidOption(name, expectation, value) {
  return new ExtractionError(
    `Option "${name}" ${expectation}, received ${describeValue(value)}.`,
    {
      code: EXTRACTION_CODES.INVALID_OPTIONS,
      field: name,
      value,
    }
  );
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof RegExp) return String(value);
  return `type "${typeof value}"`;
}

function annotatePageContext(error, pageSource) {
  if (!(error instanceof ExtractionError)) {
    return;
  }

  if (error.page === null) {
    error.page = pageSource.page;
  }
  if (error.fixture === null) {
    error.fixture = pageSource.fixture;
  }
}

module.exports = {
  DEFAULT_MAX_ROWS,
  DEFAULT_REQUIRED_HEADERS,
  EXTRACTION_OPTION_KEYS,
  EXTRACTED_FIELDS,
  extractRecords,
  normalizeExtractionOptions,
};
