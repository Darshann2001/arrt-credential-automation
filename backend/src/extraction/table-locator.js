'use strict';

/**
 * Locates the results table by inspecting table headers.
 *
 * Table and column positions are never hardcoded. The best-matching table wins;
 * missing required headers produce HEADER_MISMATCH so the caller can add aliases
 * deliberately rather than extracting the wrong columns.
 */

const {
  DEFAULT_REQUIRED_FIELDS,
  FIELD_ALIASES,
  normalizeHeaderLabel,
  mapHeaders,
} = require('./column-mapper');
const { ExtractionError, EXTRACTION_CODES } = require('./errors');
const { normalizeWhitespace } = require('../utils/name-normalizer.util');

const HEADER_SCAN_ROWS = 5;

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {object} [options]
 * @param {string|null} [options.tableSelector]
 * @param {object} [options.aliases]
 * @param {string[]} [options.requiredFields]
 * @returns {object}
 */
function locateResultsTable($, options = {}) {
  if (typeof $ !== 'function') {
    throw new TypeError('locateResultsTable expects a Cheerio API instance.');
  }

  const {
    tableSelector = null,
    aliases = FIELD_ALIASES,
    requiredFields = DEFAULT_REQUIRED_FIELDS,
  } = options;

  const tables = tableSelector
    ? $(tableSelector).toArray()
    : $('table').toArray();

  if (tables.length === 0) {
    throw new ExtractionError('No <table> element found in the HTML page.', {
      code: EXTRACTION_CODES.TABLE_NOT_FOUND,
      details: { tableSelector },
    });
  }

  let best = null;

  tables.forEach((table, tableIndex) => {
    const header = findBestHeaderRow($, table, { aliases, requiredFields });
    if (!header) {
      return;
    }

    if (!best || header.score > best.header.score) {
      best = { table, tableIndex, header };
    }
  });

  if (!best) {
    throw new ExtractionError(
      'No table with recognizable result headers was found.',
      {
        code: EXTRACTION_CODES.HEADER_MISMATCH,
        details: {
          foundTables: tables.length,
          requiredFields,
        },
      }
    );
  }

  const { header, table, tableIndex } = best;

  if (header.mapping.missing.length > 0) {
    throw new ExtractionError(
      `Results table is missing required header(s): ${header.mapping.missing.join(
        ', '
      )}. Found headers: ${header.labels.join(' | ')}.`,
      {
        code: EXTRACTION_CODES.HEADER_MISMATCH,
        details: {
          missing: header.mapping.missing,
          headers: header.labels,
          tableIndex,
        },
      }
    );
  }

  return {
    table,
    tableIndex,
    headerRow: header.row,
    headerLabels: header.labels,
    headerCellCount: header.cellCount,
    columns: header.mapping.columns,
    columnLabels: header.mapping.labels,
    duplicateHeaders: header.mapping.duplicateHeaders,
  };
}

function findBestHeaderRow($, table, options) {
  const rows = directRows($, table).slice(0, HEADER_SCAN_ROWS);
  let best = null;

  rows.forEach((row, rowIndex) => {
    const cells = $(row).children('th, td').toArray();
    if (cells.length === 0) {
      return;
    }

    const labels = cells.map((cell) => normalizeWhitespace($(cell).text()));
    if (labels.every((label) => !label)) {
      return;
    }

    const mapping = mapHeaders(labels, options);
    const score = Object.keys(mapping.columns).length;

    if (score > 0 && (!best || score > best.score)) {
      best = {
        row,
        rowIndex,
        labels,
        cellCount: cells.length,
        mapping,
        score,
      };
    }
  });

  return best;
}

function directRows($, table) {
  return $(table)
    .find('tr')
    .toArray()
    .filter((row) => $(row).closest('table')[0] === table);
}

module.exports = {
  HEADER_SCAN_ROWS,
  locateResultsTable,
  directRows,
};
