'use strict';

/**
 * Collection orchestration.
 *
 * Flow:
 *   search plan -> provider.fetchPage -> request/error/IP monitors -> optional
 *   retry/backoff -> existing extractRecords() -> cross-page dedupe -> report.
 *
 * The service is provider-agnostic. With mock.provider.js it runs entirely
 * offline. With the ARRT adapter it refuses live work until authorization and
 * CAPTCHA scope are approved; no solver is included.
 */

const { extractRecords } = require('../extraction/extractor.service');
const { createDuplicateTracker } = require('../extraction/duplicate-detector');
const { mergeConfig } = require('./config');
const {
  AUTOMATION_CODES,
  AutomationError,
  invalidOption,
} = require('./errors');
const { createRateLimiter } = require('./rate-limiter');
const { createBackoffPolicy } = require('./backoff');
const { createCircuitBreaker } = require('./circuit-breaker');
const { createRequestMonitor } = require('./monitoring/request-monitor');
const {
  classifyError,
  createErrorMonitor,
  ERROR_CATEGORIES,
} = require('./monitoring/error-monitor');
const { createIpMonitor } = require('./monitoring/ip-monitor');
const {
  assertProvider,
  normalizeProviderResult,
  PROVIDER_MODES,
} = require('./providers/data-source.provider');

const STOP_REASONS = Object.freeze({
  PLAN_EXHAUSTED: 'PLAN_EXHAUSTED',
  TARGET_REACHED: 'TARGET_REACHED',
  REQUEST_LIMIT_EXCEEDED: 'REQUEST_LIMIT_EXCEEDED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  AUTHORIZATION_REQUIRED: 'AUTHORIZATION_REQUIRED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
});

/**
 * @param {object[]|{searches: object[]}} input
 * @param {object} options
 * @param {object} options.provider
 * @param {object} [options.config]
 * @param {object} [options.request]
 * @param {object} [options.retry]
 * @param {object} [options.target]
 * @param {object} [options.requestMonitor]
 * @param {object} [options.errorMonitor]
 * @param {object} [options.ipMonitor]
 * @param {object} [options.rateLimiter]
 * @param {object} [options.backoff]
 * @param {object} [options.circuitBreaker]
 * @param {object} [options.sessionManager]
 * @param {boolean} [options.allowLiveProvider=false]
 * @param {object|null} [options.authorization]
 * @param {string|null} [options.ipLabel]
 * @param {boolean} [options.stopOnAccessDenial=true]
 * @param {boolean} [options.stopOnCaptcha=true]
 * @param {boolean} [options.stopOnExtractionError=true]
 * @param {boolean} [options.closeSession=true]
 * @param {object} [options.extraction]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.wait]
 * @returns {Promise<object>}
 */
async function collectRecords(input, options = {}) {
  const searches = normalizeSearches(input);
  const provider = assertProvider(options.provider);
  const config = mergeConfig(options.config || {});
  const settings = resolveSettings(options, config);
  const now = settings.now;
  const wait = settings.wait;
  const startedAt = now();
  const startedAtIso = new Date(startedAt).toISOString();

  assertLiveProviderAllowed(provider, options);

  const requestMonitor =
    options.requestMonitor || createRequestMonitor({ now });
  const errorMonitor =
    options.errorMonitor || createErrorMonitor({ now });
  const ipMonitor =
    options.ipMonitor || createIpMonitor({ now });
  const rateLimiter =
    options.rateLimiter ||
    createRateLimiter({
      minIntervalMs: settings.request.minIntervalMs,
      maxRequestsPerWindow: settings.request.maxRequestsPerWindow,
      windowMs: settings.request.windowMs,
      now,
      wait,
    });
  const backoff =
    options.backoff ||
    createBackoffPolicy({
      ...config.retry,
      ...(options.retry || {}),
      now,
    });
  const circuitBreaker =
    options.circuitBreaker ||
    createCircuitBreaker({
      ...config.circuitBreaker,
      ...(options.circuitBreakerOptions || {}),
      now,
    });
  const session = options.sessionManager || null;

  const records = [];
  const rejectedRows = [];
  const pageReports = [];
  const pageErrors = [];
  const crossPageDuplicates = [];
  const pageDuplicateDetails = [];
  const duplicateTracker = createDuplicateTracker();

  const totals = {
    totalRows: 0,
    rejectedCount: 0,
    withinPageDuplicateCount: 0,
    ignoredRowCount: 0,
  };
  let pagesCollected = 0;
  let requests = 0;
  let retries = 0;
  let searchesAttempted = 0;
  let searchesCompleted = 0;
  let searchesSkipped = 0;
  let stopReason = null;

  if (session) {
    await session.start();
  }

  try {
    for (let index = 0; index < searches.length; index += 1) {
      if (records.length >= settings.target.max) {
        stopReason = STOP_REASONS.TARGET_REACHED;
        break;
      }

      let attempt = 0;
      let searchDone = false;

      while (!searchDone && !stopReason) {
        if (requests >= settings.request.maxRequests) {
          stopReason = STOP_REASONS.REQUEST_LIMIT_EXCEEDED;
          break;
        }

        const gate = circuitBreaker.canRequest();

        if (!gate.allowed) {
          stopReason = STOP_REASONS.CIRCUIT_OPEN;
          errorMonitor.record(
            new AutomationError(
              `Circuit breaker is ${gate.state}; stopping before request.`,
              {
                code: AUTOMATION_CODES.CIRCUIT_OPEN,
                retryable: false,
                details: { retryAfterMs: gate.retryAfterMs },
              }
            ),
            { attempt }
          );
          break;
        }

        attempt += 1;
        await rateLimiter.acquire();
        requests += 1;

        if (!searchDone && attempt === 1) {
          searchesAttempted += 1;
        }

        if (session) {
          session.recordRequest({ timestamp: new Date(now()).toISOString() });
        }

        const requestStartedAt = now();
        let status = null;
        let url = null;
        let retryAfter = null;

        try {
          const rawResult = await provider.fetchPage(searches[index], {
            searchIndex: index,
            attempt,
            requestNumber: requests,
            session,
          });
          const result = normalizeProviderResult(rawResult, {
            url: rawResult?.url ?? null,
          });
          status = result.status;
          url = result.url;
          retryAfter =
            result.headers?.['retry-after'] ??
            result.headers?.['Retry-After'] ??
            null;

          const durationMs = Math.max(0, now() - requestStartedAt);
          const captcha = result.captcha;

          if (captcha && captcha.present) {
            requestMonitor.record({
              url,
              method: 'POST',
              status,
              durationMs,
              attempt,
              retryCount: attempt - 1,
              outcome: 'captcha',
              captcha: true,
              captchaType: captcha.type ?? null,
            });
            ipMonitor.observe({
              ip: settings.ipLabel,
              status,
              captcha: true,
            });
            errorMonitor.record(
              new AutomationError('CAPTCHA detected on a provider page.', {
                code: AUTOMATION_CODES.CAPTCHA_DETECTED,
                retryable: false,
                url,
                status,
                details: {
                  captchaType: captcha.type ?? null,
                  siteKeyPresent: Boolean(captcha.siteKey),
                },
              }),
              { status, url, attempt }
            );
            stopReason = settings.stopOnCaptcha
              ? STOP_REASONS.CAPTCHA_DETECTED
              : null;

            if (!settings.stopOnCaptcha) {
              searchesSkipped += 1;
              searchDone = true;
            }
            break;
          }

          if (status === 403) {
            requestMonitor.record({
              url,
              method: 'POST',
              status,
              durationMs,
              attempt,
              retryCount: attempt - 1,
              outcome: 'access_denied',
            });
            ipMonitor.observe({ ip: settings.ipLabel, status });
            circuitBreaker.recordFailure();
            errorMonitor.record(
              new AutomationError('Provider returned HTTP 403.', {
                code: AUTOMATION_CODES.ACCESS_DENIED,
                retryable: false,
                url,
                status,
              }),
              { status, url, attempt }
            );

            if (settings.stopOnAccessDenial) {
              stopReason = STOP_REASONS.ACCESS_DENIED;
            } else {
              searchesSkipped += 1;
              searchDone = true;
            }
            break;
          }

          if (status === 429) {
            requestMonitor.record({
              url,
              method: 'POST',
              status,
              durationMs,
              attempt,
              retryCount: attempt - 1,
              outcome: 'rate_limited',
            });
            ipMonitor.observe({ ip: settings.ipLabel, status });
            circuitBreaker.recordFailure();
            errorMonitor.record(
              new AutomationError('Provider returned HTTP 429.', {
                code: AUTOMATION_CODES.RATE_LIMITED,
                retryable: true,
                url,
                status,
              }),
              { status, url, attempt }
            );

            const retry = await handleRetry({
              attempt,
              retryAfter,
              backoff,
              wait,
              maxRetries: settings.retry.maxRetries,
            });

            if (retry.retry) {
              retries += 1;
              continue;
            }

            if (retry.exceedsMaxRetryAfter) {
              errorMonitor.record(
                new AutomationError(
                  'Retry-After exceeds the configured maximum; stopping.',
                  {
                    code: AUTOMATION_CODES.RATE_LIMITED,
                    retryable: false,
                    url,
                    status,
                    details: { delayMs: retry.delayMs },
                  }
                ),
                { status, url, attempt }
              );
              stopReason = STOP_REASONS.RATE_LIMITED;
            } else if (settings.stopOnAccessDenial) {
              stopReason = STOP_REASONS.RATE_LIMITED;
            } else {
              searchesSkipped += 1;
              searchDone = true;
            }
            break;
          }

          if (status >= 400) {
            requestMonitor.record({
              url,
              method: 'POST',
              status,
              durationMs,
              attempt,
              retryCount: attempt - 1,
              outcome: 'http_error',
            });
            ipMonitor.observe({ ip: settings.ipLabel, status });
            circuitBreaker.recordFailure();

            const httpError = new AutomationError(
              `Provider returned HTTP ${status}.`,
              {
                code:
                  status >= 500
                    ? AUTOMATION_CODES.PROVIDER_ERROR
                    : AUTOMATION_CODES.PROVIDER_ERROR,
                retryable: status === 408 || status >= 500,
                url,
                status,
              }
            );
            errorMonitor.record(httpError, { status, url, attempt });

            if (
              httpError.retryable &&
              attempt <= settings.retry.maxRetries
            ) {
              const delay = backoff.computeDelay(attempt, retryAfter);
              if (delay.exceedsMaxRetryAfter) {
                stopReason = STOP_REASONS.PROVIDER_ERROR;
                break;
              }
              retries += 1;
              await wait(delay.delayMs);
              continue;
            }

            stopReason = STOP_REASONS.PROVIDER_ERROR;
            break;
          }

          requestMonitor.record({
            url,
            method: 'POST',
            status,
            durationMs,
            attempt,
            retryCount: attempt - 1,
            outcome: 'success',
          });
          ipMonitor.observe({ ip: settings.ipLabel, status });
          circuitBreaker.recordSuccess();

          const pageNumber = pagesCollected + 1;

          try {
            const pageResult = extractRecords(
              {
                html: result.html,
                page: pageNumber,
                fixture: result.fixture,
                sourceUrl: result.sourceUrl,
              },
              {
                ...config.extract,
                ...(options.extraction || {}),
                dedupe: true,
              }
            );

            ingestPage({
              pageResult,
              result,
              pageNumber,
              records,
              rejectedRows,
              pageReports,
              pageDuplicateDetails,
              duplicateTracker,
              crossPageDuplicates,
              totals,
            });

            pagesCollected += 1;
            searchesCompleted += 1;
          } catch (extractionError) {
            pageErrors.push({
              pageNumber,
              searchIndex: index,
              url,
              code: extractionError.code || 'EXTRACTION_ERROR',
              message: extractionError.message,
            });
            errorMonitor.record(extractionError, {
              url,
              attempt,
              status,
            });

            if (settings.stopOnExtractionError) {
              stopReason = STOP_REASONS.EXTRACTION_FAILED;
              break;
            }
          }

          searchDone = true;
        } catch (error) {
          const durationMs = Math.max(0, now() - requestStartedAt);
          const classified = classifyError(error, { status, url, attempt });

          requestMonitor.record({
            url,
            method: 'POST',
            status: status ?? classified.status,
            durationMs,
            attempt,
            retryCount: attempt - 1,
            outcome: outcomeForCategory(classified.category),
            errorCode: classified.code,
          });
          errorMonitor.record(error, { status, url, attempt });
          ipMonitor.observe({
            ip: settings.ipLabel,
            status: status ?? classified.status,
          });

          if (classified.category === ERROR_CATEGORIES.AUTHORIZATION) {
            stopReason = STOP_REASONS.AUTHORIZATION_REQUIRED;
            break;
          }

          if (classified.category === ERROR_CATEGORIES.ACCESS_DENIED) {
            circuitBreaker.recordFailure();

            if (settings.stopOnAccessDenial) {
              stopReason = STOP_REASONS.ACCESS_DENIED;
            } else {
              searchesSkipped += 1;
              searchDone = true;
            }
            break;
          }

          if (classified.category === ERROR_CATEGORIES.CAPTCHA) {
            stopReason = settings.stopOnCaptcha
              ? STOP_REASONS.CAPTCHA_DETECTED
              : null;

            if (!settings.stopOnCaptcha) {
              searchesSkipped += 1;
              searchDone = true;
            }
            break;
          }

          if (classified.category === ERROR_CATEGORIES.RATE_LIMITED) {
            circuitBreaker.recordFailure();
            const retry = await handleRetry({
              attempt,
              retryAfter,
              backoff,
              wait,
              maxRetries: settings.retry.maxRetries,
            });

            if (retry.retry) {
              retries += 1;
              continue;
            }

            stopReason = STOP_REASONS.RATE_LIMITED;
            break;
          }

          if (classified.retryable && attempt <= settings.retry.maxRetries) {
            circuitBreaker.recordFailure();
            const delay = backoff.computeDelay(attempt, retryAfter);

            if (delay.exceedsMaxRetryAfter) {
              stopReason = STOP_REASONS.RATE_LIMITED;
              break;
            }

            retries += 1;
            await wait(delay.delayMs);
            continue;
          }

          circuitBreaker.recordFailure();
          stopReason =
            classified.category === ERROR_CATEGORIES.TIMEOUT
              ? STOP_REASONS.REQUEST_TIMEOUT
              : STOP_REASONS.PROVIDER_ERROR;
          break;
        }
      }

      if (stopReason) {
        break;
      }
    }

    if (!stopReason) {
      stopReason = STOP_REASONS.PLAN_EXHAUSTED;
    }
  } finally {
    if (session) {
      await session.stop(stopReason);

      if (settings.closeSession) {
        await session.close();
      }
    }
  }

  const durationMs = Math.max(0, now() - startedAt);
  const duplicateCount =
    totals.withinPageDuplicateCount + crossPageDuplicates.length;
  const countsConsistent =
    totals.totalRows === records.length + totals.rejectedCount + duplicateCount;
  const completed =
    stopReason === STOP_REASONS.PLAN_EXHAUSTED ||
    stopReason === STOP_REASONS.TARGET_REACHED;

  return {
    status: completed ? 'completed' : 'stopped',
    stopReason,
    totalRows: totals.totalRows,
    acceptedCount: records.length,
    rejectedCount: totals.rejectedCount,
    duplicateCount,
    records,
    rejectedRows,
    stats: buildCollectionStats({
      provider,
      searchesPlanned: searches.length,
      searchesAttempted,
      searchesCompleted,
      searchesSkipped,
      pagesCollected,
      requests,
      retries,
      totalRows: totals.totalRows,
      acceptedCount: records.length,
      rejectedCount: totals.rejectedCount,
      duplicateCount,
      withinPageDuplicateCount: totals.withinPageDuplicateCount,
      crossPageDuplicateCount: crossPageDuplicates.length,
      countsConsistent,
      pageReports,
      pageErrors,
      rejectedRows,
      pageDuplicateDetails,
      crossPageDuplicates,
      ignoredRowCount: totals.ignoredRowCount,
      target: {
        min: settings.target.min,
        max: settings.target.max,
        reached: records.length >= settings.target.min,
        maxReached: records.length >= settings.target.max,
      },
      requestMonitor,
      errorMonitor,
      ipMonitor,
      rateLimiter,
      backoff,
      circuitBreaker,
      session,
      startedAtIso,
      durationMs,
    }),
  };
}

async function handleRetry({ attempt, retryAfter, backoff, wait, maxRetries }) {
  if (attempt > maxRetries) {
    return { retry: false, exceedsMaxRetryAfter: false, delayMs: 0 };
  }

  const computed = backoff.computeDelay(attempt, retryAfter);

  if (computed.exceedsMaxRetryAfter) {
    return {
      retry: false,
      exceedsMaxRetryAfter: true,
      delayMs: computed.delayMs,
    };
  }

  await wait(computed.delayMs);

  return {
    retry: true,
    exceedsMaxRetryAfter: false,
    delayMs: computed.delayMs,
  };
}

function ingestPage({
  pageResult,
  result,
  pageNumber,
  records,
  rejectedRows,
  pageReports,
  pageDuplicateDetails,
  duplicateTracker,
  crossPageDuplicates,
  totals,
}) {
  totals.totalRows += pageResult.totalRows;
  totals.rejectedCount += pageResult.rejectedCount;
  totals.withinPageDuplicateCount += pageResult.duplicateCount;
  totals.ignoredRowCount += pageResult.stats.ignoredRowCount;

  rejectedRows.push(...pageResult.rejectedRows);
  pageReports.push(...pageResult.stats.pages);
  pageDuplicateDetails.push(...pageResult.stats.duplicates);

  for (const record of pageResult.records) {
    const check = duplicateTracker.check(record);

    if (check.duplicate) {
      crossPageDuplicates.push({
        key: check.key,
        strategy: check.strategy,
        page: pageNumber,
        rowNumber: record.source?.rowNumber ?? null,
        recordId: record.recordId ?? null,
        fullName: record.fullName ?? null,
        duplicateOf: {
          page: check.first.source?.page ?? null,
          rowNumber: check.first.source?.rowNumber ?? null,
          recordId: check.first.recordId ?? null,
        },
        source: {
          page: pageNumber,
          fixture: result.fixture ?? null,
          sourceUrl: result.sourceUrl ?? result.url ?? null,
        },
      });
    } else {
      records.push(record);
    }
  }
}

function buildCollectionStats(details) {
  const primaryErrorsByCode = {};
  const allErrorsByCode = {};

  for (const row of details.rejectedRows) {
    const primary = row.code || 'ROW_REJECTED';
    primaryErrorsByCode[primary] = (primaryErrorsByCode[primary] || 0) + 1;

    for (const error of row.errors || []) {
      allErrorsByCode[error.code] = (allErrorsByCode[error.code] || 0) + 1;
    }
  }

  const duplicateStrategies = {};

  for (const duplicate of [
    ...details.pageDuplicateDetails,
    ...details.crossPageDuplicates,
  ]) {
    const strategy = duplicate.strategy || 'unknown';
    duplicateStrategies[strategy] = (duplicateStrategies[strategy] || 0) + 1;
  }

  return {
    searchesPlanned: details.searchesPlanned,
    searchesAttempted: details.searchesAttempted,
    searchesCompleted: details.searchesCompleted,
    searchesSkipped: details.searchesSkipped,
    pagesCollected: details.pagesCollected,
    requests: details.requests,
    retries: details.retries,
    totalRows: details.totalRows,
    acceptedCount: details.acceptedCount,
    rejectedCount: details.rejectedCount,
    duplicateCount: details.duplicateCount,
    countsConsistent: details.countsConsistent,
    acceptanceRate: ratio(details.acceptedCount, details.totalRows),
    rejectionRate: ratio(details.rejectedCount, details.totalRows),
    duplicateRate: ratio(details.duplicateCount, details.totalRows),
    withinPageDuplicateCount: details.withinPageDuplicateCount,
    crossPageDuplicateCount: details.crossPageDuplicateCount,
    duplicateStrategies,
    crossPageDuplicates: details.crossPageDuplicates,
    target: {
      ...details.target,
      shortfall: Math.max(0, details.target.min - details.acceptedCount),
    },
    extraction: {
      pages: details.pageReports,
      ignoredRowCount: details.ignoredRowCount,
      primaryErrorsByCode,
      allErrorsByCode,
      pageErrors: details.pageErrors,
    },
    monitoring: {
      requests: details.requestMonitor.summary(),
      errors: details.errorMonitor.summary(),
      ip: details.ipMonitor.summary(),
      recentRequests: details.requestMonitor.recent(20),
      recentErrors: details.errorMonitor.recent(20),
    },
    rateLimiter: details.rateLimiter.snapshot(),
    backoff: details.backoff.snapshot(),
    circuitBreaker: details.circuitBreaker.snapshot(),
    session: details.session ? details.session.snapshot() : null,
    provider: {
      id: details.provider.id,
      mode: details.provider.mode,
      requiresBrowser: Boolean(details.provider.requiresBrowser),
    },
    startedAt: details.startedAtIso,
    durationMs: details.durationMs,
  };
}

function normalizeSearches(input) {
  const searches =
    !Array.isArray(input) &&
    input &&
    typeof input === 'object' &&
    Array.isArray(input.searches)
      ? input.searches
      : input;

  if (!Array.isArray(searches) || searches.length === 0) {
    throw new AutomationError('At least one search combination is required.', {
      code: AUTOMATION_CODES.NO_SEARCHES,
    });
  }

  return searches.map((search, index) => {
    if (!search || typeof search !== 'object' || Array.isArray(search)) {
      throw invalidOption(
        `searches[${index}]`,
        'must be an object with firstName and lastName',
        search
      );
    }

    const firstName =
      typeof search.firstName === 'string' ? search.firstName.trim() : '';
    const lastName =
      typeof search.lastName === 'string' ? search.lastName.trim() : '';

    if (!firstName || !lastName) {
      throw invalidOption(
        `searches[${index}]`,
        'must contain non-empty firstName and lastName strings',
        search
      );
    }

    return { firstName, lastName };
  });
}

function resolveSettings(options, config) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const wait =
    typeof options.wait === 'function'
      ? options.wait
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const request = {
    ...config.request,
    ...(options.request || {}),
  };

  if (options.maxRequests !== undefined) {
    request.maxRequests = options.maxRequests;
  }
  if (options.minIntervalMs !== undefined) {
    request.minIntervalMs = options.minIntervalMs;
  }
  if (options.maxRequestsPerWindow !== undefined) {
    request.maxRequestsPerWindow = options.maxRequestsPerWindow;
  }
  if (options.windowMs !== undefined) {
    request.windowMs = options.windowMs;
  }

  assertPositiveInteger(request.maxRequests, 'maxRequests');
  assertNonNegativeInteger(request.minIntervalMs, 'minIntervalMs');
  assertPositiveInteger(request.windowMs, 'windowMs');

  if (
    request.maxRequestsPerWindow !== null &&
    request.maxRequestsPerWindow !== undefined
  ) {
    assertPositiveInteger(
      request.maxRequestsPerWindow,
      'maxRequestsPerWindow'
    );
  }

  const retry = {
    ...config.retry,
    ...(options.retry || {}),
  };

  if (options.maxRetries !== undefined) {
    retry.maxRetries = options.maxRetries;
  }

  assertNonNegativeInteger(retry.maxRetries, 'maxRetries');

  const targetInput =
    options.target ||
    options.targetRecords ||
    config.target;

  const target = {
    min: targetInput.min ?? config.target.min,
    max: targetInput.max ?? config.target.max,
  };

  assertPositiveInteger(target.min, 'target.min');
  assertPositiveInteger(target.max, 'target.max');

  if (target.min > target.max) {
    throw invalidOption('target', 'must satisfy min <= max', target);
  }

  return {
    now,
    wait,
    request,
    retry,
    target,
    ipLabel:
      typeof options.ipLabel === 'string' && options.ipLabel.trim()
        ? options.ipLabel.trim()
        : null,
    stopOnAccessDenial:
      options.stopOnAccessDenial ?? config.stopOnAccessDenial,
    stopOnCaptcha: options.stopOnCaptcha ?? config.stopOnCaptcha,
    stopOnExtractionError: options.stopOnExtractionError !== false,
    closeSession: options.closeSession !== false,
  };
}

function assertLiveProviderAllowed(provider, options) {
  if (provider.mode !== PROVIDER_MODES.LIVE) {
    return;
  }

  if (options.allowLiveProvider !== true) {
    throw new AutomationError(
      'Live providers are disabled. Set allowLiveProvider=true only after written authorization is recorded.',
      {
        code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
        retryable: false,
        details: { providerId: provider.id },
      }
    );
  }

  if (!options.authorization || options.authorization.confirmed !== true) {
    throw new AutomationError(
      'Live collection requires authorization.confirmed=true.',
      {
        code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
        retryable: false,
        details: { providerId: provider.id },
      }
    );
  }
}

function outcomeForCategory(category) {
  switch (category) {
    case ERROR_CATEGORIES.TIMEOUT:
      return 'timeout';
    case ERROR_CATEGORIES.CONNECTION:
    case ERROR_CATEGORIES.DNS:
    case ERROR_CATEGORIES.TLS:
      return 'connection_error';
    case ERROR_CATEGORIES.ACCESS_DENIED:
      return 'access_denied';
    case ERROR_CATEGORIES.RATE_LIMITED:
      return 'rate_limited';
    case ERROR_CATEGORIES.CAPTCHA:
      return 'captcha';
    case ERROR_CATEGORIES.PROVIDER:
      return 'http_error';
    default:
      return 'unknown';
  }
}

function ratio(part, total) {
  return total === 0 ? 0 : part / total;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw invalidOption(name, 'must be a positive integer', value);
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidOption(name, 'must be a non-negative integer', value);
  }
}

module.exports = {
  STOP_REASONS,
  collectRecords,
  normalizeSearches,
};
