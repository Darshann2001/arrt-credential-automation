'use strict';

/**
 * Request observation log.
 *
 * Records operational facts only: status, duration, retries, CAPTCHA presence,
 * timeout/connection outcomes and timestamps. It never stores cookies, bearer
 * tokens, CAPTCHA responses or form values.
 */

const { invalidOption } = require('../errors');

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.maxEvents=5000]
 */
function createRequestMonitor(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxEvents = readPositiveInteger(options.maxEvents, 5000, 'maxEvents');
  const events = [];

  /**
   * @param {object} input
   * @param {string|null} [input.url]
   * @param {string} [input.method='GET']
   * @param {number|null} [input.status]
   * @param {number|null} [input.durationMs]
   * @param {number} [input.attempt=1]
   * @param {number} [input.retryCount=0]
   * @param {string} [input.outcome]
   * @param {boolean} [input.captcha=false]
   * @param {string|null} [input.captchaType]
   * @param {string|null} [input.errorCode]
   * @param {string|null} [input.ip]
   * @param {string} [input.timestamp]
   */
  function record(input = {}) {
    const status =
      input.status === undefined || input.status === null
        ? null
        : readInteger(input.status, 'status');

    const event = {
      timestamp: normalizeTimestamp(input.timestamp, now),
      method: typeof input.method === 'string' ? input.method : 'GET',
      url: typeof input.url === 'string' ? input.url : null,
      status,
      durationMs:
        input.durationMs === undefined || input.durationMs === null
          ? null
          : readNonNegativeNumber(input.durationMs, 'durationMs'),
      attempt: readPositiveInteger(input.attempt, 1, 'attempt'),
      retryCount: readNonNegativeInteger(
        input.retryCount,
        input.attempt ? Math.max(0, input.attempt - 1) : 0,
        'retryCount'
      ),
      outcome: input.outcome || deriveOutcome(status, input.captcha),
      captcha: Boolean(input.captcha),
      captchaType: input.captchaType ?? null,
      errorCode: input.errorCode ?? null,
      ip: input.ip ?? null,
    };

    events.push(event);

    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }

    return event;
  }

  function summary() {
    const statusCounts = {};
    const outcomeCounts = {};
    const durations = [];
    let http403Count = 0;
    let http429Count = 0;
    let http4xxCount = 0;
    let http5xxCount = 0;
    let captchaCount = 0;
    let timeoutCount = 0;
    let connectionFailureCount = 0;
    let retryCount = 0;
    let retriedRequests = 0;

    for (const event of events) {
      if (event.status !== null) {
        const key = String(event.status);
        statusCounts[key] = (statusCounts[key] || 0) + 1;

        if (event.status === 403) http403Count += 1;
        if (event.status === 429) http429Count += 1;
        if (event.status >= 400 && event.status < 500) http4xxCount += 1;
        if (event.status >= 500 && event.status < 600) http5xxCount += 1;
      }

      outcomeCounts[event.outcome] = (outcomeCounts[event.outcome] || 0) + 1;

      if (event.captcha) captchaCount += 1;
      if (event.outcome === 'timeout') timeoutCount += 1;
      if (event.outcome === 'connection_error') connectionFailureCount += 1;

      retryCount += event.retryCount;
      if (event.retryCount > 0) retriedRequests += 1;

      if (event.durationMs !== null) {
        durations.push(event.durationMs);
      }
    }

    durations.sort((a, b) => a - b);

    return {
      totalRequests: events.length,
      statusCounts,
      http403Count,
      http429Count,
      http4xxCount,
      http5xxCount,
      captchaCount,
      timeoutCount,
      connectionFailureCount,
      retryCount,
      retriedRequests,
      outcomeCounts,
      durationMs: summarizeDurations(durations),
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

function deriveOutcome(status, captcha) {
  if (captcha) return 'captcha';
  if (status === null) return 'unknown';
  if (status === 403) return 'access_denied';
  if (status === 429) return 'rate_limited';
  if (status >= 400) return 'http_error';
  return 'success';
}

function summarizeDurations(sorted) {
  if (sorted.length === 0) {
    return { count: 0, min: null, max: null, avg: null, p50: null, p95: null };
  }

  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  );

  return sorted[index];
}

function normalizeTimestamp(value, now) {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(now()).toISOString();
}

function readInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw invalidOption(name, 'must be an integer', value);
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

function readNonNegativeInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw invalidOption(name, 'must be a non-negative integer', value);
  }

  return value;
}

function readNonNegativeNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalidOption(name, 'must be a non-negative number', value);
  }

  return value;
}

module.exports = {
  createRequestMonitor,
};
