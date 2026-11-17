'use strict';

/**
 * Error classification and observation.
 *
 * Categories are intentionally operational (timeout, connection, access
 * denial, CAPTCHA, extraction) rather than attempts to diagnose ARRT internals.
 */

const { AutomationError, AUTOMATION_CODES, invalidOption } = require('../errors');

const ERROR_CATEGORIES = Object.freeze({
  TIMEOUT: 'timeout',
  CONNECTION: 'connection_failure',
  DNS: 'dns_failure',
  TLS: 'tls_failure',
  ACCESS_DENIED: 'access_denied',
  RATE_LIMITED: 'rate_limited',
  CAPTCHA: 'captcha',
  AUTHORIZATION: 'authorization',
  EXTRACTION: 'extraction_failure',
  BROWSER: 'browser_unavailable',
  PROVIDER: 'provider_failure',
  CIRCUIT_OPEN: 'circuit_open',
  UNKNOWN: 'unknown',
});

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.maxEvents=5000]
 * @param {boolean} [options.includeStack=false]
 */
function createErrorMonitor(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxEvents = readPositiveInteger(options.maxEvents, 5000, 'maxEvents');
  const includeStack = Boolean(options.includeStack);
  const events = [];

  /**
   * @param {unknown} error
   * @param {object} [context]
   * @param {number|null} [context.status]
   * @param {string|null} [context.url]
   * @param {number} [context.attempt]
   */
  function record(error, context = {}) {
    const classified = classifyError(error, context);
    const event = {
      timestamp: new Date(now()).toISOString(),
      category: classified.category,
      code: classified.code,
      message: classified.message,
      status: classified.status,
      retryable: classified.retryable,
      url: context.url ?? classified.url ?? null,
      attempt: context.attempt ?? null,
      stack: includeStack ? classified.stack : null,
    };

    events.push(event);

    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }

    return event;
  }

  function summary() {
    const categoryCounts = {};
    const codeCounts = {};
    let retryableCount = 0;

    for (const event of events) {
      categoryCounts[event.category] =
        (categoryCounts[event.category] || 0) + 1;
      codeCounts[event.code] = (codeCounts[event.code] || 0) + 1;
      if (event.retryable) retryableCount += 1;
    }

    return {
      totalErrors: events.length,
      retryableCount,
      categoryCounts,
      codeCounts,
      firstTimestamp: events.length > 0 ? events[0].timestamp : null,
      lastTimestamp:
        events.length > 0 ? events[events.length - 1].timestamp : null,
      eventsRetained: events.length,
      maxEvents,
    };
  }

  function recent(limit = 20) {
    const count = readPositiveInteger(limit, 20, 'limit');
    return events.slice(Math.max(0, events.length - count));
  }

  function getEvents() {
    return events.slice();
  }

  function reset() {
    events.length = 0;
  }

  return { record, summary, recent, getEvents, reset };
}

/**
 * @param {unknown} error
 * @param {object} [context]
 * @returns {{ category: string, code: string, message: string, status: number|null, retryable: boolean, url: string|null, stack: string|null }}
 */
function classifyError(error, context = {}) {
  const status = normalizeStatus(context.status ?? error?.status);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown automation error';
  const rawCode =
    typeof error?.code === 'string' ? error.code.toUpperCase() : null;
  const name = typeof error?.name === 'string' ? error.name : '';
  const url = context.url ?? error?.url ?? null;
  const stack = error instanceof Error ? error.stack || null : null;

  if (
    error instanceof AutomationError &&
    error.code === AUTOMATION_CODES.CAPTCHA_DETECTED
  ) {
    return result(ERROR_CATEGORIES.CAPTCHA, error.code, message, status, false, url, stack);
  }

  if (
    error instanceof AutomationError &&
    error.code === AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL
  ) {
    return result(
      ERROR_CATEGORIES.CAPTCHA,
      error.code,
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (
    error instanceof AutomationError &&
    (error.code === AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED ||
      error.code === AUTOMATION_CODES.INVALID_OPTIONS ||
      error.code === AUTOMATION_CODES.NO_SEARCHES)
  ) {
    return result(
      ERROR_CATEGORIES.AUTHORIZATION,
      error.code,
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (error instanceof AutomationError && error.code === AUTOMATION_CODES.BROWSER_UNAVAILABLE) {
    return result(
      ERROR_CATEGORIES.BROWSER,
      error.code,
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (error instanceof AutomationError && error.code === AUTOMATION_CODES.CIRCUIT_OPEN) {
    return result(
      ERROR_CATEGORIES.CIRCUIT_OPEN,
      error.code,
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (
    error?.name === 'ExtractionError' ||
    error?.code?.startsWith?.('HEADER_') ||
    error?.code?.startsWith?.('INVALID_') ||
    error?.code?.startsWith?.('MISSING_')
  ) {
    return result(
      ERROR_CATEGORIES.EXTRACTION,
      rawCode || 'EXTRACTION_ERROR',
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (status === 403) {
    return result(
      ERROR_CATEGORIES.ACCESS_DENIED,
      'HTTP_403',
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (status === 429) {
    return result(
      ERROR_CATEGORIES.RATE_LIMITED,
      'HTTP_429',
      message,
      status,
      true,
      url,
      stack
    );
  }

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    rawCode === 'ETIMEDOUT' ||
    /timed?\s*out/i.test(message)
  ) {
    return result(
      ERROR_CATEGORIES.TIMEOUT,
      rawCode || 'REQUEST_TIMEOUT',
      message,
      status,
      true,
      url,
      stack
    );
  }

  if (rawCode === 'ENOTFOUND' || rawCode === 'EAI_AGAIN') {
    return result(
      ERROR_CATEGORIES.DNS,
      rawCode,
      message,
      status,
      true,
      url,
      stack
    );
  }

  if (
    rawCode === 'ECONNREFUSED' ||
    rawCode === 'ECONNRESET' ||
    rawCode === 'ECONNABORTED' ||
    rawCode === 'EPIPE' ||
    rawCode === 'EHOSTUNREACH' ||
    rawCode === 'ENETUNREACH'
  ) {
    return result(
      ERROR_CATEGORIES.CONNECTION,
      rawCode,
      message,
      status,
      true,
      url,
      stack
    );
  }

  if (
    rawCode === 'CERT_HAS_EXPIRED' ||
    rawCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    rawCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    /certificate|tls|ssl/i.test(message)
  ) {
    return result(
      ERROR_CATEGORIES.TLS,
      rawCode || 'TLS_ERROR',
      message,
      status,
      false,
      url,
      stack
    );
  }

  if (status !== null && status >= 400) {
    return result(
      ERROR_CATEGORIES.PROVIDER,
      rawCode || `HTTP_${status}`,
      message,
      status,
      status === 408 || status >= 500,
      url,
      stack
    );
  }

  return result(
    ERROR_CATEGORIES.UNKNOWN,
    rawCode || 'UNKNOWN_ERROR',
    message,
    status,
    Boolean(error?.retryable),
    url,
    stack
  );
}

function result(category, code, message, status, retryable, url, stack) {
  return { category, code, message, status, retryable, url, stack };
}

function normalizeStatus(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isInteger(number) ? number : null;
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

module.exports = {
  ERROR_CATEGORIES,
  classifyError,
  createErrorMonitor,
};
