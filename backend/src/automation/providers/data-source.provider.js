'use strict';

/**
 * Data-source provider contract.
 *
 * A provider returns one HTML page per search request. It does not write records
 * to storage and does not bypass CAPTCHAs. Live providers must be gated behind
 * written authorization and an approved CAPTCHA procedure.
 *
 * Required shape:
 *   {
 *     id: string,
 *     mode: 'mock' | 'live',
 *     requiresBrowser: boolean,
 *     fetchPage(search, context): Promise<{
 *       html: string,
 *       url?: string,
 *       status?: number,
 *       fixture?: string|null,
 *       sourceUrl?: string|null,
 *       captcha?: { present: boolean, type?: string, siteKey?: string } | null
 *     }>
 *   }
 */

const { AUTOMATION_CODES, AutomationError } = require('../errors');

const PROVIDER_MODES = Object.freeze({
  MOCK: 'mock',
  LIVE: 'live',
});

const PROVIDER_CONTRACT_VERSION = 1;

/**
 * @param {unknown} provider
 * @returns {object}
 */
function assertProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new AutomationError('A data-source provider object is required.', {
      code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      details: { field: 'provider', value: typeof provider },
    });
  }

  if (typeof provider.id !== 'string' || !provider.id.trim()) {
    throw new AutomationError('Provider must expose a non-empty string id.', {
      code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      details: { field: 'provider.id' },
    });
  }

  if (!Object.values(PROVIDER_MODES).includes(provider.mode)) {
    throw new AutomationError(
      `Provider mode must be one of: ${Object.values(PROVIDER_MODES).join(', ')}.`,
      {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
        details: { field: 'provider.mode', value: provider.mode },
      }
    );
  }

  if (typeof provider.fetchPage !== 'function') {
    throw new AutomationError('Provider must implement fetchPage(search, context).', {
      code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      details: { field: 'provider.fetchPage' },
    });
  }

  return provider;
}

/**
 * Validates and normalizes one provider result.
 *
 * @param {unknown} result
 * @param {object} [context]
 * @returns {object}
 */
function normalizeProviderResult(result, context = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AutomationError('Provider fetchPage() must resolve to an object.', {
      code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      details: { field: 'result', value: typeof result },
    });
  }

  const status =
    result.status === undefined || result.status === null
      ? 200
      : Number(result.status);

  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new AutomationError('Provider result status must be an HTTP status code.', {
      code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      details: { field: 'result.status', value: result.status },
    });
  }

  if (
    typeof result.html !== 'string' ||
    (!result.html.trim() && status < 400)
  ) {
    throw new AutomationError(
      'Provider result must contain non-empty HTML in "html".',
      {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
        details: { field: 'result.html', status },
      }
    );
  }

  const captcha = result.captcha || null;

  if (
    captcha !== null &&
    (typeof captcha !== 'object' || typeof captcha.present !== 'boolean')
  ) {
    throw new AutomationError(
      'Provider result captcha must be null or { present: boolean, ... }.',
      {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
        details: { field: 'result.captcha' },
      }
    );
  }

  return {
    html: result.html,
    url: result.url ?? context.url ?? null,
    status,
    fixture: result.fixture ?? context.fixture ?? null,
    sourceUrl: result.sourceUrl ?? result.url ?? context.sourceUrl ?? null,
    captcha,
    headers: result.headers && typeof result.headers === 'object' ? result.headers : {},
    pageNumber: result.pageNumber ?? context.pageNumber ?? null,
  };
}

module.exports = {
  PROVIDER_CONTRACT_VERSION,
  PROVIDER_MODES,
  assertProvider,
  normalizeProviderResult,
};
