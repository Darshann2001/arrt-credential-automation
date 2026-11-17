'use strict';

/**
 * Row extraction.
 *
 * Reads data rows beneath the detected header row and returns raw mapped values
 * plus provenance. Column positions come exclusively from the header mapping.
 *
 * Structural rules:
 * - Rows before/including the header row are ignored.
 * - Repeated header rows are skipped.
 * - A single-cell row such as "No results found." is ignored (not counted).
 * - Rows with no cells or no non-empty mapped values are returned as malformed
 *   so they can be reported rather than silently dropped.
 * - `colspan` is expanded up to a bounded limit. `rowspan` is not expanded in
 *   this phase and is documented as a limitation.
 */

const { normalizeHeaderLabel, mapHeaders } = require('./column-mapper');
const { EXTRACTED_FIELDS } = require('./fields');
const { directRows } = require('./table-locator');
const { normalizeWhitespace } = require('../utils/name-normalizer.util');

const MAX_COLSPAN = 50;
const DEFAULT_NO_RESULTS_PATTERN =
  /^(?:no\s+(?:matching\s+)?(?:results?|records?|matches?|data|entries)|nothing\s+found|0\s+(?:results?|records?|matches?))\b/i;

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {object} tableInfo Result of `locateResultsTable`.
 * @param {object} [options]
 * @param {number|string|null} [options.page]
 * @param {string|null} [options.fixture]
 * @param {string|null} [options.sourceUrl]
 * @param {RegExp} [options.noResultsPattern]
 * @param {object} [options.aliases]
 * @returns {{
 *   rows: object[],
 *   ignored: object[]
 * }}
 */
function extractRows($, tableInfo, options = {}) {
  const {
    page = null,
    fixture = null,
    sourceUrl = null,
    noResultsPattern = DEFAULT_NO_RESULTS_PATTERN,
    aliases,
  } = options;

  const { table, headerRow, columns } = tableInfo;
  const allRows = directRows($, table);
  const headerIndex = allRows.indexOf(headerRow);
  const rowsAfterHeader = headerIndex === -1 ? [] : allRows.slice(headerIndex + 1);

  const rows = [];
  const ignored = [];

  rowsAfterHeader.forEach((row, index) => {
    const rowNumber = index + 1;
    const sourceRowIndex = headerIndex + index + 2;
    const provenance = { page, fixture, sourceUrl, rowNumber, sourceRowIndex };

    const cells = readCells($, row);
    const nonEmptyCellCount = cells.filter(Boolean).length;

    if (isRepeatedHeaderRow($, row, aliases)) {
      ignored.push({
        reason: 'repeated-header',
        text: cells.filter(Boolean).join(' | '),
        source: provenance,
      });
      return;
    }

    if (isNoResultsRow(cells, noResultsPattern)) {
      ignored.push({
        reason: 'no-results',
        text: cells.find(Boolean) || '',
        source: provenance,
      });
      return;
    }

    if (cells.length === 0) {
      rows.push({
        values: emptyValues(),
        recordId: null,
        provenance,
        malformed: 'Row contains no table cells.',
      });
      return;
    }

    const values = {};
    for (const field of EXTRACTED_FIELDS) {
      const columnIndex = columns[field];
      values[field] =
        columnIndex === undefined ? null : cells[columnIndex] ?? null;
    }

    const recordId =
      columns.recordId === undefined
        ? null
        : cells[columns.recordId] || null;

    if (nonEmptyCellCount === 0) {
      rows.push({
        values,
        recordId,
        provenance,
        malformed: 'Row has no non-empty cells.',
      });
      return;
    }

    const hasMappedValue = EXTRACTED_FIELDS.some(
      (field) => values[field] !== null && values[field] !== ''
    );

    if (!hasMappedValue) {
      rows.push({
        values,
        recordId,
        provenance,
        malformed: 'Row has no values in the mapped result columns.',
      });
      return;
    }

    rows.push({
      values,
      recordId,
      provenance,
      malformed: null,
    });
  });

  return { rows, ignored };
}

function readCells($, row) {
  const cells = [];

  $(row)
    .children('th, td')
    .each((_, cell) => {
      const text = normalizeWhitespace($(cell).text());
      const parsed = Number.parseInt($(cell).attr('colspan') || '1', 10);
      const colspan = Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, 1), MAX_COLSPAN)
        : 1;

      cells.push(text);
      for (let extra = 1; extra < colspan; extra += 1) {
        cells.push('');
      }
    });

  return cells;
}

function isRepeatedHeaderRow($, row, aliases) {
  const cellElements = $(row).children('th, td').toArray();
  if (cellElements.length === 0) {
    return false;
  }

  const allHeaderCells = cellElements.every(
    (cell) => (cell.tagName || '').toLowerCase() === 'th'
  );
  if (allHeaderCells) {
    return true;
  }

  const labels = cellElements.map((cell) => normalizeWhitespace($(cell).text()));
  if (labels.every((label) => !label)) {
    return false;
  }

  const mapping = mapHeaders(labels, aliases ? { aliases } : {});
  if (Object.keys(mapping.columns).length < 2) {
    return false;
  }

  // A repeated header row may use <td> cells. Require every non-empty cell to
  // be a recognized header label so a data row cannot be mistaken for one.
  return labels.every((label) => {
    if (!label) {
      return true;
    }
    const normalized = normalizeHeaderLabel(label);
    return (
      Object.keys(mapHeaders([normalized], aliases ? { aliases } : {}).columns)
        .length > 0 || normalized === ''
    );
  });
}

function isNoResultsRow(cells, pattern) {
  const nonEmpty = cells.filter(Boolean);
  if (nonEmpty.length !== 1) {
    return false;
  }

  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    const result = pattern.test(nonEmpty[0]);
    pattern.lastIndex = 0;
    return result;
  }

  return false;
}

function emptyValues() {
  return {
    fullName: '',
    city: '',
    state: '',
    credentialString: '',
  };
}

module.exports = {
  MAX_COLSPAN,
  DEFAULT_NO_RESULTS_PATTERN,
  extractRows,
  readCells,
};
