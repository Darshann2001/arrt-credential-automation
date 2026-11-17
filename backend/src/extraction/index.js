'use strict';

/**
 * Public extraction API.
 *
 * Fixture-only: no network access, no browser automation, no ARRT integration.
 */

const errors = require('./errors');
const loader = require('./html-loader');
const parser = require('./dom-parser');
const columnMapper = require('./column-mapper');
const tableLocator = require('./table-locator');
const rowExtractor = require('./row-extractor');
const normalizer = require('./field-normalizer');
const validator = require('./field-validator');
const recordBuilder = require('./record-builder');
const duplicateDetector = require('./duplicate-detector');
const statistics = require('./statistics');
const fields = require('./fields');
const extractor = require('./extractor.service');

module.exports = {
  // Errors
  ExtractionError: errors.ExtractionError,
  EXTRACTION_CODES: errors.EXTRACTION_CODES,

  // Fields
  EXTRACTED_FIELDS: fields.EXTRACTED_FIELDS,
  OPTIONAL_FIELDS: fields.OPTIONAL_FIELDS,
  ALL_FIELDS: fields.ALL_FIELDS,

  // Loading and parsing
  DEFAULT_MAX_BYTES: loader.DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PAGES: loader.DEFAULT_MAX_PAGES,
  loadPage: loader.loadPage,
  loadPages: loader.loadPages,
  loadFixture: loader.loadFixture,
  parseHtml: parser.parseHtml,

  // Table discovery and mapping
  DEFAULT_REQUIRED_FIELDS: columnMapper.DEFAULT_REQUIRED_FIELDS,
  FIELD_ALIASES: columnMapper.FIELD_ALIASES,
  normalizeHeaderLabel: columnMapper.normalizeHeaderLabel,
  mapHeaders: columnMapper.mapHeaders,
  HEADER_SCAN_ROWS: tableLocator.HEADER_SCAN_ROWS,
  locateResultsTable: tableLocator.locateResultsTable,
  directRows: tableLocator.directRows,

  // Rows and normalization
  MAX_COLSPAN: rowExtractor.MAX_COLSPAN,
  DEFAULT_NO_RESULTS_PATTERN: rowExtractor.DEFAULT_NO_RESULTS_PATTERN,
  extractRows: rowExtractor.extractRows,
  readCells: rowExtractor.readCells,
  normalizeText: normalizer.normalizeText,
  normalizeFullName: normalizer.normalizeFullName,
  normalizeCity: normalizer.normalizeCity,
  normalizeState: normalizer.normalizeState,
  normalizeCredentialString: normalizer.normalizeCredentialString,
  normalizeRecordId: normalizer.normalizeRecordId,
  normalizeRecordValues: normalizer.normalizeRecordValues,
  isRecognizedState: normalizer.isRecognizedState,
  STATE_CODES: normalizer.STATE_CODES,

  // Validation
  validateFullName: validator.validateFullName,
  validateCity: validator.validateCity,
  validateState: validator.validateState,
  validateCredentialString: validator.validateCredentialString,
  validateRecordValues: validator.validateRecordValues,

  // Records, duplicates and statistics
  buildRecord: recordBuilder.buildRecord,
  buildRejectedRow: recordBuilder.buildRejectedRow,
  buildMalformedRejection: recordBuilder.buildMalformedRejection,
  buildDedupeKey: duplicateDetector.buildDedupeKey,
  createDuplicateTracker: duplicateDetector.createDuplicateTracker,
  RECORD_ID_STRATEGY: duplicateDetector.RECORD_ID_STRATEGY,
  COMPOSITE_STRATEGY: duplicateDetector.COMPOSITE_STRATEGY,
  buildStatistics: statistics.buildStatistics,

  // Service
  DEFAULT_MAX_ROWS: extractor.DEFAULT_MAX_ROWS,
  DEFAULT_REQUIRED_HEADERS: extractor.DEFAULT_REQUIRED_HEADERS,
  EXTRACTION_OPTION_KEYS: extractor.EXTRACTION_OPTION_KEYS,
  normalizeExtractionOptions: extractor.normalizeExtractionOptions,
  extractRecords: extractor.extractRecords,
};
