'use strict';

/**
 * Public automation API.
 *
 * Live ARRT access remains disabled. The mock provider and monitoring pipeline
 * are fully runnable offline.
 */

const errors = require('./errors');
const config = require('./config');
const rateLimiter = require('./rate-limiter');
const backoff = require('./backoff');
const circuitBreaker = require('./circuit-breaker');
const browserService = require('./browser.service');
const sessionManager = require('./session.manager');
const pageHandler = require('./page-handler');
const arrtAdapter = require('./arrt.adapter');
const collection = require('./collection.service');
const requestMonitor = require('./monitoring/request-monitor');
const errorMonitor = require('./monitoring/error-monitor');
const ipMonitor = require('./monitoring/ip-monitor');
const providerContract = require('./providers/data-source.provider');
const mockProvider = require('./providers/mock.provider');

module.exports = {
  // Errors
  AUTOMATION_CODES: errors.AUTOMATION_CODES,
  AutomationError: errors.AutomationError,

  // Configuration
  DEFAULT_AUTOMATION_CONFIG: config.DEFAULT_AUTOMATION_CONFIG,
  DEFAULT_TARGET_RECORDS: config.DEFAULT_TARGET_RECORDS,
  createDefaultConfig: config.createDefaultConfig,
  mergeConfig: config.mergeConfig,

  // Pacing and resilience
  createRateLimiter: rateLimiter.createRateLimiter,
  createBackoffPolicy: backoff.createBackoffPolicy,
  parseRetryAfter: backoff.parseRetryAfter,
  CIRCUIT_STATES: circuitBreaker.STATES,
  createCircuitBreaker: circuitBreaker.createCircuitBreaker,

  // Browser and session (Puppeteer loaded lazily, not installed here)
  createBrowserService: browserService.createBrowserService,
  createSessionManager: sessionManager.createSessionManager,
  detectCaptchaInHtml: pageHandler.detectCaptchaInHtml,
  readResponseStatus: pageHandler.readResponseStatus,
  createPageHandler: pageHandler.createPageHandler,

  // ARRT adapter (inert until authorization and CAPTCHA approval)
  ARRT_PAGE_URL: arrtAdapter.ARRT_PAGE_URL,
  ARRT_OBSERVED: arrtAdapter.ARRT_OBSERVED,
  createArrtAdapter: arrtAdapter.createArrtAdapter,

  // Providers
  PROVIDER_CONTRACT_VERSION: providerContract.PROVIDER_CONTRACT_VERSION,
  PROVIDER_MODES: providerContract.PROVIDER_MODES,
  assertProvider: providerContract.assertProvider,
  normalizeProviderResult: providerContract.normalizeProviderResult,
  DEFAULT_MOCK_FIXTURES: mockProvider.DEFAULT_FIXTURES,
  createMockProvider: mockProvider.createMockProvider,

  // Monitoring
  createRequestMonitor: requestMonitor.createRequestMonitor,
  ERROR_CATEGORIES: errorMonitor.ERROR_CATEGORIES,
  classifyError: errorMonitor.classifyError,
  createErrorMonitor: errorMonitor.createErrorMonitor,
  createIpMonitor: ipMonitor.createIpMonitor,

  // Collection
  STOP_REASONS: collection.STOP_REASONS,
  collectRecords: collection.collectRecords,
  normalizeSearches: collection.normalizeSearches,
};
