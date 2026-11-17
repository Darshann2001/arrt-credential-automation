'use strict';

/**
 * Runtime configuration plus the hard safety gates for live collection.
 *
 * Nothing here throws at import time so tests and tooling can import the API
 * without a database. `assertRuntimeEnv` is called only by the server entry
 * point. `assertLiveCollectionAllowed` must be called before any live provider,
 * browser or ARRT request; it fails closed when authorization, CAPTCHA approval
 * or permitted collection limits are absent or invalid.
 */

const { AutomationError, AUTOMATION_CODES } = require('../automation/errors');
const {
  LIVE_ACCESS_REQUIREMENTS,
  LIVE_LIMIT_BOUNDS,
} = require('../automation/config');

const DEFAULT_PORT = 4000;
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

const LIVE_LIMIT_KEYS = Object.freeze([
  'maxRecordsPerJob',
  'maxSearchesPerJob',
  'maxJobsPerDay',
]);

const LIVE_LIMIT_ENV_NAMES = Object.freeze({
  maxRecordsPerJob: 'LIVE_MAX_RECORDS_PER_JOB',
  maxSearchesPerJob: 'LIVE_MAX_SEARCHES_PER_JOB',
  maxJobsPerDay: 'LIVE_MAX_JOBS_PER_DAY',
});

const DISABLED_LIVE = Object.freeze({
  authorization: Object.freeze({
    confirmed: false,
    reference: null,
    scope: Object.freeze([]),
  }),
  captcha: Object.freeze({ approved: false, approvalReference: null }),
  limits: Object.freeze({
    maxRecordsPerJob: null,
    maxSearchesPerJob: null,
    maxJobsPerDay: null,
  }),
  browser: Object.freeze({
    executablePath: null,
    userDataDir: null,
    headless: false,
  }),
});

/**
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {{
 *   nodeEnv: string,
 *   port: number,
 *   databaseUrl: string|null,
 *   frontendOrigins: string[],
 *   isProduction: boolean,
 *   live: object
 * }}
 */
function readEnv(source = process.env) {
  const nodeEnv = String(source.NODE_ENV || 'development').trim() || 'development';

  return {
    nodeEnv,
    port: parsePort(source.PORT),
    databaseUrl: normalizeOptional(source.DATABASE_URL),
    frontendOrigins: parseOrigins(source.FRONTEND_URL),
    isProduction: nodeEnv === 'production',
    collectionCron: {
      enabled: parseBoolean(
        source.COLLECTION_CRON_ENABLED,
        'COLLECTION_CRON_ENABLED',
        false
      ),
      hour: parseCronHour(source.COLLECTION_CRON_HOUR),
    },
    live: {
      authorization: {
        confirmed: parseBoolean(
          source.LIVE_AUTHORIZATION_CONFIRMED,
          'LIVE_AUTHORIZATION_CONFIRMED',
          false
        ),
        reference: normalizeOptional(source.LIVE_AUTHORIZATION_REFERENCE),
        scope: parseScope(source.LIVE_AUTHORIZATION_SCOPE),
      },
      captcha: {
        approved: parseBoolean(
          source.LIVE_CAPTCHA_APPROVED,
          'LIVE_CAPTCHA_APPROVED',
          false
        ),
        approvalReference: normalizeOptional(
          source.LIVE_CAPTCHA_APPROVAL_REFERENCE
        ),
      },
      limits: {
        maxRecordsPerJob: parseLimit(
          source.LIVE_MAX_RECORDS_PER_JOB,
          'maxRecordsPerJob'
        ),
        maxSearchesPerJob: parseLimit(
          source.LIVE_MAX_SEARCHES_PER_JOB,
          'maxSearchesPerJob'
        ),
        maxJobsPerDay: parseLimit(
          source.LIVE_MAX_JOBS_PER_DAY,
          'maxJobsPerDay'
        ),
      },
      browser: {
        executablePath: normalizeOptional(
          source.LIVE_BROWSER_EXECUTABLE_PATH
        ),
        userDataDir: normalizeOptional(source.LIVE_BROWSER_USER_DATA_DIR),
        headless: parseBoolean(
          source.LIVE_BROWSER_HEADLESS,
          'LIVE_BROWSER_HEADLESS',
          false
        ),
      },
    },
  };
}

/**
 * @param {ReturnType<typeof readEnv>} env
 */
function assertRuntimeEnv(env) {
  if (!env.databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy backend/.env.example to backend/.env and set a PostgreSQL connection string.'
    );
  }
}

/**
 * Hard gate for live collection. Call this before constructing a live provider,
 * launching a browser or making any ARRT request. Missing or invalid values are
 * errors, never warnings, and no value here can disable the authorization or
 * CAPTCHA requirements.
 *
 * @param {ReturnType<typeof readEnv>|{live?: object}} config
 * @param {{ requestedTarget?: number, plannedSearches?: number }} [request]
 * @returns {object} frozen snapshot of the approved live settings
 */
function assertLiveCollectionAllowed(config, request = {}) {
  const live =
    config && config.live && typeof config.live === 'object'
      ? config.live
      : DISABLED_LIVE;

  assertAuthorization(live.authorization);
  assertCaptchaApproval(live.captcha);
  assertPermittedLimits(live.limits);
  assertVisibleBrowser(live.browser);

  if (request.requestedTarget !== undefined && request.requestedTarget !== null) {
    const value = request.requestedTarget;
    if (!Number.isInteger(value) || value < 0) {
      throw new AutomationError(
        'requestedTarget must be a non-negative integer.',
        {
          code: AUTOMATION_CODES.INVALID_OPTIONS,
          retryable: false,
          details: { field: 'requestedTarget' },
        }
      );
    }
    if (value > live.limits.maxRecordsPerJob) {
      throw limitError(
        'maxRecordsPerJob',
        `requestedTarget (${value}) exceeds the permitted limit of ${live.limits.maxRecordsPerJob} records per job.`
      );
    }
  }

  if (request.plannedSearches !== undefined && request.plannedSearches !== null) {
    const value = request.plannedSearches;
    if (!Number.isInteger(value) || value < 1) {
      throw new AutomationError(
        'plannedSearches must be a positive integer.',
        {
          code: AUTOMATION_CODES.INVALID_OPTIONS,
          retryable: false,
          details: { field: 'plannedSearches' },
        }
      );
    }
    if (value > live.limits.maxSearchesPerJob) {
      throw limitError(
        'maxSearchesPerJob',
        `plannedSearches (${value}) exceeds the permitted limit of ${live.limits.maxSearchesPerJob} searches per job.`
      );
    }
  }

  return Object.freeze({
    authorization: Object.freeze({ ...live.authorization }),
    captcha: Object.freeze({ ...live.captcha }),
    limits: Object.freeze({ ...live.limits }),
    browser: Object.freeze({ ...live.browser }),
  });
}

function assertAuthorization(authorization) {
  const value = authorization || {};

  if (value.confirmed !== true) {
    throw authorizationError(
      'Live collection is blocked: written authorization is not confirmed.',
      ['LIVE_AUTHORIZATION_CONFIRMED=true']
    );
  }

  if (!hasText(value.reference)) {
    throw authorizationError(
      'Live collection is blocked: an authorization reference is required.',
      ['LIVE_AUTHORIZATION_REFERENCE']
    );
  }

  if (!Array.isArray(value.scope) || value.scope.length === 0) {
    throw authorizationError(
      'Live collection is blocked: at least one authorized scope is required.',
      ['LIVE_AUTHORIZATION_SCOPE']
    );
  }
}

function assertCaptchaApproval(captcha) {
  const value = captcha || {};

  if (value.approved !== true) {
    throw new AutomationError(
      'Live collection is blocked: the manual CAPTCHA procedure is not approved.',
      {
        code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL,
        retryable: false,
        details: {
          required: ['LIVE_CAPTCHA_APPROVED=true'],
          note: 'CAPTCHA solving, token reading and token injection are not implemented.',
        },
      }
    );
  }

  if (!hasText(value.approvalReference)) {
    throw new AutomationError(
      'Live collection is blocked: a CAPTCHA approval reference is required.',
      {
        code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL,
        retryable: false,
        details: { required: ['LIVE_CAPTCHA_APPROVAL_REFERENCE'] },
      }
    );
  }
}

function assertPermittedLimits(limits) {
  const value = limits || {};

  for (const key of LIVE_LIMIT_KEYS) {
    const envName = LIVE_LIMIT_ENV_NAMES[key];
    const bound = LIVE_LIMIT_BOUNDS[key];
    const limit = value[key];

    if (!Number.isInteger(limit) || limit < 1) {
      throw limitError(
        key,
        `Permitted collection limit ${envName} must be a positive integer before live execution.`
      );
    }

    if (limit > bound) {
      throw limitError(
        key,
        `Permitted collection limit ${envName} cannot exceed ${bound}.`
      );
    }
  }
}

function assertVisibleBrowser(browser) {
  if (LIVE_ACCESS_REQUIREMENTS.requireVisibleBrowser && browser?.headless !== false) {
    throw new AutomationError(
      'Live collection must use a visible browser for supervised operation.',
      {
        code: AUTOMATION_CODES.INVALID_OPTIONS,
        retryable: false,
        details: { field: 'LIVE_BROWSER_HEADLESS', required: false },
      }
    );
  }
}

function authorizationError(message, required) {
  return new AutomationError(message, {
    code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
    retryable: false,
    details: { required },
  });
}

function limitError(key, message) {
  return new AutomationError(message, {
    code: AUTOMATION_CODES.COLLECTION_LIMIT_EXCEEDED,
    retryable: false,
    details: {
      field: LIVE_LIMIT_ENV_NAMES[key],
      max: LIVE_LIMIT_BOUNDS[key],
    },
  });
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {boolean} fallback
 */
function parseBoolean(value, name, fallback) {
  const text = normalizeOptional(value);
  if (text === null) {
    return fallback;
  }

  const normalized = text.toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new Error(`${name} must be "true" or "false", received "${text}".`);
}

/**
 * @param {unknown} value
 * @param {keyof typeof LIVE_LIMIT_BOUNDS} key
 */
function parseLimit(value, key) {
  const text = normalizeOptional(value);
  if (text === null) {
    return null;
  }

  const portLike = Number(text);
  if (!Number.isInteger(portLike) || portLike < 1) {
    throw new Error(
      `${LIVE_LIMIT_ENV_NAMES[key]} must be a positive integer, received "${text}".`
    );
  }
  if (portLike > LIVE_LIMIT_BOUNDS[key]) {
    throw new Error(
      `${LIVE_LIMIT_ENV_NAMES[key]} cannot exceed ${LIVE_LIMIT_BOUNDS[key]}.`
    );
  }

  return portLike;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseScope(value) {
  const raw = normalizeOptional(value);
  if (raw === null) {
    return [];
  }

  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function parseCronHour(value) {
  const text = normalizeOptional(value);
  if (text === null) {
    return 2;
  }

  const hour = Number(text);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(
      `COLLECTION_CRON_HOUR must be an integer between 0 and 23, received "${text}".`
    );
  }
  return hour;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function parsePort(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, received "${value}".`);
  }

  return port;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseOrigins(value) {
  const raw = normalizeOptional(value);
  const list = raw ? raw.split(',') : [];
  const origins = list
    .map((entry) => entry.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : [DEFAULT_FRONTEND_URL];
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeOptional(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_FRONTEND_URL,
  LIVE_LIMIT_KEYS,
  readEnv,
  assertRuntimeEnv,
  assertLiveCollectionAllowed,
  parseCronHour,
  parsePort,
  parseOrigins,
};
