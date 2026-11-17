'use strict';

/**
 * HTML source loader.
 *
 * Supports inline HTML strings, local fixture file paths and page objects:
 *   { html, fixture, page }
 *   { fixturePath, page }
 *   { html, sourceUrl, page }   // sourceUrl is metadata only
 *
 * Remote URLs are rejected and never fetched. No ARRT access happens here.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ExtractionError, EXTRACTION_CODES } = require('./errors');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;

/**
 * Loads one or more HTML pages.
 *
 * @param {unknown} input Array of sources, a single source, or `{ pages }`.
 * @param {object} [options]
 * @param {number} [options.maxBytes=2097152]
 * @param {number} [options.maxPages=100]
 * @returns {{ html: string, fixture: string|null, page: number, sourceUrl: string|null }[]}
 */
function loadPages(input, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  assertPositiveInteger(maxBytes, 'maxBytes');
  assertPositiveInteger(maxPages, 'maxPages');

  const pagesInput =
    !Array.isArray(input) &&
    input &&
    typeof input === 'object' &&
    Object.prototype.hasOwnProperty.call(input, 'pages')
      ? input.pages
      : input;

  const sources = Array.isArray(pagesInput) ? pagesInput : [pagesInput];

  if (sources.length === 0 || sources[0] === undefined || sources[0] === null) {
    throw new ExtractionError(
      'At least one HTML page source is required.',
      { code: EXTRACTION_CODES.NO_PAGES }
    );
  }

  if (sources.length > maxPages) {
    throw new ExtractionError(
      `Received ${sources.length} page sources, exceeding maxPages (${maxPages}).`,
      { code: EXTRACTION_CODES.PAGE_LIMIT_EXCEEDED }
    );
  }

  return sources.map((source, index) =>
    loadPage(source, {
      maxBytes,
      defaultPage: index + 1,
    })
  );
}

/**
 * Loads a single page source.
 *
 * @param {unknown} source
 * @param {object} [options]
 * @param {number} [options.maxBytes=2097152]
 * @param {number} [options.defaultPage=1]
 * @returns {{ html: string, fixture: string|null, page: number, sourceUrl: string|null }}
 */
function loadPage(source, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const defaultPage = options.defaultPage ?? 1;

  let html;
  let fixture = null;
  let page = defaultPage;
  let sourceUrl = null;

  if (typeof source === 'string') {
    const trimmed = source.trim();

    if (/^https?:\/\//i.test(trimmed)) {
      throw new ExtractionError(
        'Remote URLs are not supported. Provide local HTML or a fixture path.',
        { code: EXTRACTION_CODES.UNSUPPORTED_SOURCE, value: source }
      );
    }

    if (trimmed.startsWith('<')) {
      html = source;
    } else {
      const file = readFixtureFile(trimmed, maxBytes);
      html = file.html;
      fixture = path.basename(trimmed);
    }
  } else if (source && typeof source === 'object' && !Array.isArray(source)) {
    fixture = source.fixture ?? source.id ?? null;
    page = source.page ?? source.pageNumber ?? defaultPage;
    sourceUrl = source.sourceUrl ?? source.url ?? null;

    if (typeof source.html === 'string') {
      html = source.html;
    } else if (
      typeof source.fixturePath === 'string' ||
      typeof source.path === 'string'
    ) {
      const fixturePath = source.fixturePath || source.path;
      const file = readFixtureFile(fixturePath, maxBytes);
      html = file.html;
      fixture = fixture || path.basename(fixturePath);
    } else if (typeof sourceUrl === 'string') {
      throw new ExtractionError(
        'Only inline HTML or local fixture paths are supported; remote URLs are not fetched.',
        {
          code: EXTRACTION_CODES.UNSUPPORTED_SOURCE,
          page,
          fixture,
          value: sourceUrl,
        }
      );
    } else {
      throw new ExtractionError(
        'Page source must include "html", "fixturePath" or "path".',
        {
          code: EXTRACTION_CODES.INVALID_PAGE_SOURCE,
          page,
          fixture,
          value: source,
        }
      );
    }
  } else {
    throw new ExtractionError(
      'Page source must be an HTML string, a local file path, or a page object.',
      { code: EXTRACTION_CODES.INVALID_PAGE_SOURCE, value: source }
    );
  }

  if (!Number.isInteger(page) || page < 1) {
    throw new ExtractionError(
      `Page number must be a positive integer, received ${String(page)}.`,
      { code: EXTRACTION_CODES.INVALID_PAGE_SOURCE, page, fixture }
    );
  }

  if (typeof html !== 'string' || !html.trim()) {
    throw new ExtractionError('HTML page must be a non-empty string.', {
      code: EXTRACTION_CODES.EMPTY_HTML,
      page,
      fixture,
    });
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > maxBytes) {
    throw new ExtractionError(
      `HTML page is ${bytes} bytes, exceeding maxBytes (${maxBytes}).`,
      { code: EXTRACTION_CODES.HTML_TOO_LARGE, page, fixture }
    );
  }

  return { html, fixture, page, sourceUrl };
}

/**
 * Convenience helper for tests and scripts.
 *
 * @param {string} fixturePath
 * @param {object} [options]
 * @returns {{ html: string, fixture: string|null, page: number, sourceUrl: string|null }}
 */
function loadFixture(fixturePath, options = {}) {
  return loadPage(fixturePath, options);
}

function readFixtureFile(fixturePath, maxBytes) {
  let stats;

  try {
    stats = fs.statSync(fixturePath);
  } catch (error) {
    throw new ExtractionError(
      `Unable to read HTML fixture "${fixturePath}": ${error.message}`,
      { code: EXTRACTION_CODES.INVALID_PAGE_SOURCE, cause: error }
    );
  }

  if (!stats.isFile()) {
    throw new ExtractionError(
      `HTML fixture path is not a file: "${fixturePath}".`,
      { code: EXTRACTION_CODES.INVALID_PAGE_SOURCE }
    );
  }

  if (stats.size > maxBytes) {
    throw new ExtractionError(
      `HTML fixture is ${stats.size} bytes, exceeding maxBytes (${maxBytes}).`,
      {
        code: EXTRACTION_CODES.HTML_TOO_LARGE,
        fixture: path.basename(fixturePath),
      }
    );
  }

  try {
    return { html: fs.readFileSync(fixturePath, 'utf8') };
  } catch (error) {
    throw new ExtractionError(
      `Unable to read HTML fixture "${fixturePath}": ${error.message}`,
      { code: EXTRACTION_CODES.INVALID_PAGE_SOURCE, cause: error }
    );
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ExtractionError(
      `Option "${name}" must be a positive integer, received ${String(value)}.`,
      { code: EXTRACTION_CODES.INVALID_OPTIONS, field: name, value }
    );
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PAGES,
  loadPage,
  loadPages,
  loadFixture,
};
