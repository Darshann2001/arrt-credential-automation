'use strict';

/**
 * Minimal circuit breaker for outbound requests.
 *
 * States:
 *   closed    -> requests allowed; failures are counted.
 *   open      -> requests rejected until resetTimeoutMs elapses.
 *   half-open -> a limited number of probes allowed; success closes the circuit,
 *                failure re-opens it.
 *
 * The breaker never changes network identity or attempts to evade a block. It
 * exists to stop work when the remote side is failing or denying access.
 */

const { AUTOMATION_CODES, AutomationError, invalidOption } = require('./errors');

const STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open',
});

/**
 * @param {object} [options]
 * @param {number} [options.failureThreshold=5]
 * @param {number} [options.successThreshold=2]
 * @param {number} [options.resetTimeoutMs=60000]
 * @param {number} [options.halfOpenMaxCalls=1]
 * @param {() => number} [options.now]
 */
function createCircuitBreaker(options = {}) {
  const failureThreshold = readPositiveInteger(
    options.failureThreshold,
    5,
    'failureThreshold'
  );
  const successThreshold = readPositiveInteger(
    options.successThreshold,
    2,
    'successThreshold'
  );
  const resetTimeoutMs = readPositiveInteger(
    options.resetTimeoutMs,
    60000,
    'resetTimeoutMs'
  );
  const halfOpenMaxCalls = readPositiveInteger(
    options.halfOpenMaxCalls,
    1,
    'halfOpenMaxCalls'
  );
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let state = STATES.CLOSED;
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let halfOpenCalls = 0;
  let openedAt = null;
  let lastFailureAt = null;
  let lastSuccessAt = null;
  let totalFailures = 0;
  let totalSuccesses = 0;
  let rejectedCalls = 0;

  /**
   * @returns {{ allowed: boolean, state: string, retryAfterMs: number }}
   */
  function canRequest() {
    refreshState();

    if (state === STATES.OPEN) {
      rejectedCalls += 1;

      return {
        allowed: false,
        state,
        retryAfterMs: Math.max(
          0,
          (openedAt ?? now()) + resetTimeoutMs - now()
        ),
      };
    }

    if (state === STATES.HALF_OPEN) {
      if (halfOpenCalls >= halfOpenMaxCalls) {
        rejectedCalls += 1;
        return { allowed: false, state, retryAfterMs: 0 };
      }

      halfOpenCalls += 1;
    }

    return { allowed: true, state, retryAfterMs: 0 };
  }

  function assertCanRequest() {
    const result = canRequest();

    if (!result.allowed) {
      throw new AutomationError(
        `Circuit breaker is ${result.state}; request blocked.`,
        {
          code: AUTOMATION_CODES.CIRCUIT_OPEN,
          retryable: false,
          details: { retryAfterMs: result.retryAfterMs },
        }
      );
    }
  }

  function recordSuccess() {
    refreshState();
    totalSuccesses += 1;
    lastSuccessAt = now();
    consecutiveFailures = 0;

    if (state === STATES.HALF_OPEN) {
      consecutiveSuccesses += 1;

      if (consecutiveSuccesses >= successThreshold) {
        state = STATES.CLOSED;
        consecutiveSuccesses = 0;
        halfOpenCalls = 0;
        openedAt = null;
      }

      return;
    }

    consecutiveSuccesses += 1;
  }

  function recordFailure() {
    refreshState();
    totalFailures += 1;
    lastFailureAt = now();
    consecutiveSuccesses = 0;

    if (state === STATES.HALF_OPEN) {
      open();
      return;
    }

    consecutiveFailures += 1;

    if (consecutiveFailures >= failureThreshold) {
      open();
    }
  }

  function open() {
    state = STATES.OPEN;
    openedAt = now();
    halfOpenCalls = 0;
  }

  function refreshState() {
    if (state === STATES.OPEN && now() - openedAt >= resetTimeoutMs) {
      state = STATES.HALF_OPEN;
      halfOpenCalls = 0;
      consecutiveSuccesses = 0;
    }
  }

  function snapshot() {
    refreshState();

    return {
      state,
      failureThreshold,
      successThreshold,
      resetTimeoutMs,
      halfOpenMaxCalls,
      consecutiveFailures,
      consecutiveSuccesses,
      halfOpenCalls,
      openedAt,
      lastFailureAt,
      lastSuccessAt,
      totalFailures,
      totalSuccesses,
      rejectedCalls,
      retryAfterMs:
        state === STATES.OPEN
          ? Math.max(0, (openedAt ?? now()) + resetTimeoutMs - now())
          : 0,
    };
  }

  function reset() {
    state = STATES.CLOSED;
    consecutiveFailures = 0;
    consecutiveSuccesses = 0;
    halfOpenCalls = 0;
    openedAt = null;
    lastFailureAt = null;
    lastSuccessAt = null;
    totalFailures = 0;
    totalSuccesses = 0;
    rejectedCalls = 0;
  }

  return {
    canRequest,
    assertCanRequest,
    recordSuccess,
    recordFailure,
    snapshot,
    reset,
  };
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
  STATES,
  createCircuitBreaker,
};
