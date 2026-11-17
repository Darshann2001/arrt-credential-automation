'use strict';

/**
 * Automation error taxonomy.
 *
 * These codes describe operational conditions. They do not imply that a CAPTCHA
 * has been solved, bypassed or otherwise manipulated.
 */

const AUTOMATION_CODES = Object.freeze({
  INVALID_OPTIONS: 'AUTOMATION_INVALID_OPTIONS',
  AUTHORIZATION_NOT_CONFIRMED: 'AUTHORIZATION_NOT_CONFIRMED',
  CAPTCHA_REQUIRES_APPROVAL: 'CAPTCHA_REQUIRES_APPROVAL',
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  BROWSER_UNAVAILABLE: 'BROWSER_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_CONTRACT: 'PROVIDER_CONTRACT',
  REQUEST_LIMIT_EXCEEDED: 'REQUEST_LIMIT_EXCEEDED',
  COLLECTION_LIMIT_EXCEEDED: 'COLLECTION_LIMIT_EXCEEDED',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  TARGET_REACHED: 'TARGET_REACHED',
  NO_SEARCHES: 'NO_SEARCHES',
});

const RETRYABLE_CODES = Object.freeze([
  AUTOMATION_CODES.REQUEST_TIMEOUT,
  AUTOMATION_CODES.CONNECTION_FAILED,
  AUTOMATION_CODES.RATE_LIMITED,
  AUTOMATION_CODES.PROVIDER_ERROR,
]);

class AutomationError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string} [details.code]
   * @param {boolean} [details.retryable]
   * @param {string|null} [details.url]
   * @param {number|null} [details.status]
   * @param {object} [details.details]
   * @param {Error} [details.cause]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'AutomationError';
    this.code = details.code || AUTOMATION_CODES.PROVIDER_ERROR;
    this.retryable =
      details.retryable === undefined
        ? RETRYABLE_CODES.includes(this.code)
        : Boolean(details.retryable);
    this.url = details.url ?? null;
    this.status = details.status ?? null;
    this.details = details.details ?? null;
    this.timestamp = details.timestamp ?? new Date().toISOString();

    if (details.cause) {
      this.cause = details.cause;
    }

    Error.captureStackTrace?.(this, AutomationError);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      url: this.url,
      status: this.status,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

function invalidOption(name, expectation, value) {
  return new AutomationError(
    `Option "${name}" ${expectation}, received ${describeValue(value)}.`,
    {
      code: AUTOMATION_CODES.INVALID_OPTIONS,
      details: { field: name, value: describeValue(value) },
    }
  );
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof RegExp) return String(value);
  return `type "${typeof value}"`;
}

module.exports = {
  AUTOMATION_CODES,
  RETRYABLE_CODES,
  AutomationError,
  invalidOption,
  describeValue,
};
