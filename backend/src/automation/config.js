'use strict';

/**
 * Conservative automation defaults.
 *
 * These values are internal safety limits, not observations of ARRT capacity
 * or published ARRT limits. They must be re-validated with ARRT as part of the
 * written authorization before any live collection is enabled.
 */

const DEFAULT_TARGET_RECORDS = Object.freeze({ min: 300, max: 350 });

/**
 * Non-negotiable requirements for any live collection run. These are policy,
 * not measurements of ARRT capacity. They cannot be disabled by an env var.
 */
const LIVE_ACCESS_REQUIREMENTS = Object.freeze({
  requireWrittenAuthorization: true,
  requireCaptchaApproval: true,
  requireVisibleBrowser: true,
});

/**
 * Upper bounds accepted when an operator supplies permitted collection limits.
 * Values above these are rejected as configuration errors rather than silently
 * clamped.
 */
const LIVE_LIMIT_BOUNDS = Object.freeze({
  maxRecordsPerJob: 100000,
  maxSearchesPerJob: 10000,
  maxJobsPerDay: 1000,
});

const DEFAULT_AUTOMATION_CONFIG = Object.freeze({
  request: Object.freeze({
    timeoutMs: 30000,
    maxRequests: 100,
    minIntervalMs: 5000,
    maxRequestsPerWindow: null,
    windowMs: 60000,
  }),
  retry: Object.freeze({
    maxRetries: 2,
    baseDelayMs: 2000,
    factor: 2,
    maxDelayMs: 60000,
    jitterRatio: 0.2,
  }),
  circuitBreaker: Object.freeze({
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 60000,
    halfOpenMaxCalls: 1,
  }),
  target: DEFAULT_TARGET_RECORDS,
  stopOnAccessDenial: true,
  stopOnCaptcha: true,
  extract: Object.freeze({
    maxRows: 100000,
    dedupe: true,
  }),
});

/**
 * Creates a frozen deep copy of the default configuration.
 *
 * @returns {object}
 */
function createDefaultConfig() {
  return deepFreeze({
    request: { ...DEFAULT_AUTOMATION_CONFIG.request },
    retry: { ...DEFAULT_AUTOMATION_CONFIG.retry },
    circuitBreaker: { ...DEFAULT_AUTOMATION_CONFIG.circuitBreaker },
    target: { ...DEFAULT_AUTOMATION_CONFIG.target },
    stopOnAccessDenial: DEFAULT_AUTOMATION_CONFIG.stopOnAccessDenial,
    stopOnCaptcha: DEFAULT_AUTOMATION_CONFIG.stopOnCaptcha,
    extract: { ...DEFAULT_AUTOMATION_CONFIG.extract },
  });
}

/**
 * Shallow-merges caller overrides into the defaults. Unknown keys are rejected
 * by the individual modules that consume them.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function mergeConfig(overrides = {}) {
  const base = createDefaultConfig();

  return deepFreeze({
    ...base,
    ...overrides,
    request: { ...base.request, ...(overrides.request || {}) },
    retry: { ...base.retry, ...(overrides.retry || {}) },
    circuitBreaker: {
      ...base.circuitBreaker,
      ...(overrides.circuitBreaker || {}),
    },
    target: { ...base.target, ...(overrides.target || {}) },
    extract: { ...base.extract, ...(overrides.extract || {}) },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }

  return Object.freeze(value);
}

module.exports = {
  DEFAULT_AUTOMATION_CONFIG,
  DEFAULT_TARGET_RECORDS,
  LIVE_ACCESS_REQUIREMENTS,
  LIVE_LIMIT_BOUNDS,
  createDefaultConfig,
  mergeConfig,
};
