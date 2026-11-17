'use strict';

/**
 * Extraction error taxonomy.
 *
 * Page-level/structural problems throw ExtractionError. Row-level problems are
 * returned as plain rejection objects by the extraction service so one bad row
 * does not abort a whole page.
 */

const EXTRACTION_CODES = Object.freeze({
  NO_PAGES: 'NO_PAGES',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_PAGE_SOURCE: 'INVALID_PAGE_SOURCE',
  UNSUPPORTED_SOURCE: 'UNSUPPORTED_SOURCE',
  EMPTY_HTML: 'EMPTY_HTML',
  HTML_TOO_LARGE: 'HTML_TOO_LARGE',
  INVALID_HTML: 'INVALID_HTML',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  HEADER_MISMATCH: 'HEADER_MISMATCH',
  ROW_LIMIT_EXCEEDED: 'ROW_LIMIT_EXCEEDED',
  PAGE_LIMIT_EXCEEDED: 'PAGE_LIMIT_EXCEEDED',
  MALFORMED_ROW: 'MALFORMED_ROW',
  MISSING_FULL_NAME: 'MISSING_FULL_NAME',
  MISSING_CITY: 'MISSING_CITY',
  MISSING_STATE: 'MISSING_STATE',
  MISSING_CREDENTIAL: 'MISSING_CREDENTIAL',
  INVALID_FULL_NAME: 'INVALID_FULL_NAME',
  INVALID_CITY: 'INVALID_CITY',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
});

class ExtractionError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string} [details.code]
   * @param {string} [details.field]
   * @param {number|string|null} [details.page]
   * @param {string|null} [details.fixture]
   * @param {number|null} [details.row]
   * @param {unknown} [details.value]
   * @param {object} [details.details]
   * @param {Error} [details.cause]
   */
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'ExtractionError';
    this.code = details.code || 'EXTRACTION_ERROR';
    this.field = details.field || null;
    this.page = details.page ?? null;
    this.fixture = details.fixture ?? null;
    this.row = details.row ?? null;
    this.value = details.value;
    this.details = details.details || null;
  }
}

module.exports = {
  ExtractionError,
  EXTRACTION_CODES,
};
