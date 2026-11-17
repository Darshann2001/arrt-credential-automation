'use strict';

/**
 * Cheerio-based DOM parser.
 *
 * Cheerio does not execute scripts or fetch external resources. The resulting
 * `$` object is used for all table traversal; candidates are never parsed by
 * string splitting or regexes over raw HTML.
 */

const cheerio = require('cheerio');

const { ExtractionError, EXTRACTION_CODES } = require('./errors');

/**
 * @param {string} html
 * @param {object} [context]
 * @param {number|string|null} [context.page]
 * @param {string|null} [context.fixture]
 * @returns {import('cheerio').CheerioAPI}
 */
function parseHtml(html, context = {}) {
  const { page = null, fixture = null } = context;

  if (typeof html !== 'string' || !html.trim()) {
    throw new ExtractionError('HTML document must be a non-empty string.', {
      code: EXTRACTION_CODES.EMPTY_HTML,
      page,
      fixture,
    });
  }

  try {
    return cheerio.load(html, {
      decodeEntities: true,
      xmlMode: false,
    });
  } catch (error) {
    throw new ExtractionError(`Unable to parse HTML: ${error.message}`, {
      code: EXTRACTION_CODES.INVALID_HTML,
      page,
      fixture,
      cause: error,
    });
  }
}

module.exports = {
  parseHtml,
};
