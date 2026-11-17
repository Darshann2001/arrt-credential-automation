'use strict';

/**
 * Serialized request pacing.
 *
 * Two independent limits are supported:
 *   - a minimum interval between request starts;
 *   - an optional maximum number of starts per rolling window.
 *
 * The limiter only paces work that is already authorized. It does not discover
 * endpoints, rotate IPs or work around access controls.
 */

const { invalidOption } = require('./errors');

/**
 * @param {object} [options]
 * @param {number} [options.minIntervalMs=0]
 * @param {number|null} [options.maxRequestsPerWindow=null]
 * @param {number} [options.windowMs=60000]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.wait]
 */
function createRateLimiter(options = {}) {
  const minIntervalMs = readNonNegativeInteger(
    options.minIntervalMs,
    0,
    'minIntervalMs'
  );
  const maxRequestsPerWindow =
    options.maxRequestsPerWindow === undefined ||
    options.maxRequestsPerWindow === null
      ? null
      : readPositiveInteger(
          options.maxRequestsPerWindow,
          null,
          'maxRequestsPerWindow'
        );
  const windowMs = readPositiveInteger(options.windowMs, 60000, 'windowMs');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const wait =
    typeof options.wait === 'function' ? options.wait : defaultWait;

  let lastStartAt = null;
  let windowStartAt = null;
  let windowCount = 0;
  let acquiredCount = 0;
  let totalWaitedMs = 0;
  let queue = Promise.resolve();

  /**
   * Resolves once a request may start. Calls are serialized so concurrent
   * callers cannot exceed the configured rate.
   *
   * @returns {Promise<{ waitedMs: number, startedAt: number }>}
   */
  async function acquire() {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      let waitedMs = 0;

      if (lastStartAt !== null && minIntervalMs > 0) {
        const delay = Math.max(0, lastStartAt + minIntervalMs - now());
        if (delay > 0) {
          await wait(delay);
          waitedMs += delay;
        }
      }

      if (maxRequestsPerWindow !== null) {
        const current = now();

        if (windowStartAt === null || current - windowStartAt >= windowMs) {
          windowStartAt = current;
          windowCount = 0;
        }

        if (windowCount >= maxRequestsPerWindow) {
          const delay = Math.max(0, windowStartAt + windowMs - now());
          if (delay > 0) {
            await wait(delay);
            waitedMs += delay;
          }
          windowStartAt = now();
          windowCount = 0;
        }
      }

      lastStartAt = now();

      if (windowStartAt === null) {
        windowStartAt = lastStartAt;
      }

      windowCount += 1;
      acquiredCount += 1;
      totalWaitedMs += waitedMs;

      return { waitedMs, startedAt: lastStartAt };
    } finally {
      release();
    }
  }

  function snapshot() {
    return {
      minIntervalMs,
      maxRequestsPerWindow,
      windowMs,
      acquiredCount,
      totalWaitedMs,
      lastStartAt,
      windowStartAt,
      windowCount,
    };
  }

  function reset() {
    lastStartAt = null;
    windowStartAt = null;
    windowCount = 0;
    acquiredCount = 0;
    totalWaitedMs = 0;
  }

  return { acquire, snapshot, reset };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

module.exports = {
  createRateLimiter,
};
