'use strict';

/**
 * Exponential backoff with optional jitter and explicit Retry-After support.
 *
 * Retry-After is treated as authoritative: it is never shortened to fit the
 * exponential cap. Callers can compare the returned delay with
 * `maxRetryAfterMs` and stop instead of retrying earlier than the server asked.
 */

const { invalidOption } = require('./errors');

/**
 * @param {object} [options]
 * @param {number} [options.baseDelayMs=1000]
 * @param {number} [options.factor=2]
 * @param {number} [options.maxDelayMs=60000]
 * @param {number} [options.jitterRatio=0]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.maxRetryAfterMs=300000]
 * @param {() => number} [options.random]
 * @param {() => number} [options.now]
 */
function createBackoffPolicy(options = {}) {
  const baseDelayMs = readNonNegativeInteger(
    options.baseDelayMs,
    1000,
    'baseDelayMs'
  );
  const factor = readPositiveNumber(options.factor, 2, 'factor');
  const maxDelayMs = readPositiveInteger(
    options.maxDelayMs,
    60000,
    'maxDelayMs'
  );
  const jitterRatio = readRatio(options.jitterRatio, 0, 'jitterRatio');
  const maxRetries = readNonNegativeInteger(
    options.maxRetries,
    3,
    'maxRetries'
  );
  const maxRetryAfterMs = readPositiveInteger(
    options.maxRetryAfterMs,
    300000,
    'maxRetryAfterMs'
  );
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  /**
   * @param {number} attempt 1-based retry attempt.
   * @param {number|string|null} [retryAfter] Raw Retry-After header value.
   * @returns {{ delayMs: number, source: 'retry-after'|'exponential', attempt: number, retryAfterMs: number|null, exceedsMaxRetryAfter: boolean }}
   */
  function computeDelay(attempt, retryAfter = null) {
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw invalidOption('attempt', 'must be a positive integer', attempt);
    }

    const retryAfterMs = parseRetryAfter(retryAfter, now());

    if (retryAfterMs !== null) {
      return {
        delayMs: retryAfterMs,
        source: 'retry-after',
        attempt,
        retryAfterMs,
        exceedsMaxRetryAfter: retryAfterMs > maxRetryAfterMs,
      };
    }

    const rawDelay = baseDelayMs * Math.pow(factor, attempt - 1);
    const cappedDelay = Math.min(rawDelay, maxDelayMs);
    const jitteredDelay =
      jitterRatio > 0
        ? cappedDelay * (1 - jitterRatio * random())
        : cappedDelay;

    return {
      delayMs: Math.max(0, Math.round(jitteredDelay)),
      source: 'exponential',
      attempt,
      retryAfterMs: null,
      exceedsMaxRetryAfter: false,
    };
  }

  function shouldRetry(attempt, error) {
    if (attempt >= maxRetries) {
      return false;
    }

    if (error && error.retryable === false) {
      return false;
    }

    return true;
  }

  function snapshot() {
    return {
      baseDelayMs,
      factor,
      maxDelayMs,
      jitterRatio,
      maxRetries,
      maxRetryAfterMs,
    };
  }

  return { computeDelay, shouldRetry, parseRetryAfter, snapshot };
}

/**
 * Parses an HTTP Retry-After value.
 *
 * Accepts either delta-seconds ("120") or an HTTP date. Returns milliseconds,
 * or null when the value is absent/invalid.
 *
 * @param {number|string|null|undefined} value
 * @param {number} [nowMs]
 * @returns {number|null}
 */
function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? Math.round(value * 1000) : null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 1000);
  }

  const parsed = Date.parse(text);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, parsed - nowMs);
}

function readNonNegativeInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw invalidOption(name, 'must be a non-negative integer', value);
  }

  return value;
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw invalidOption(name, 'must be a positive integer', value);
  }

  return value;
}

function readPositiveNumber(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidOption(name, 'must be a positive number', value);
  }

  return value;
}

function readRatio(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOption(name, 'must be a number between 0 and 1', value);
  }

  return value;
}

module.exports = {
  createBackoffPolicy,
  parseRetryAfter,
};
