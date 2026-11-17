'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ARRT_OBSERVED,
  AUTOMATION_CODES,
  AutomationError,
  DEFAULT_TARGET_RECORDS,
  ERROR_CATEGORIES,
  PROVIDER_MODES,
  STOP_REASONS,
  assertProvider,
  classifyError,
  collectRecords,
  createArrtAdapter,
  createBackoffPolicy,
  createBrowserService,
  createCircuitBreaker,
  createErrorMonitor,
  createIpMonitor,
  createMockProvider,
  createPageHandler,
  createRateLimiter,
  createRequestMonitor,
  createSessionManager,
  detectCaptchaInHtml,
  normalizeProviderResult,
  parseRetryAfter,
  createDefaultConfig,
} = require('../index');

const {
  assertLiveCollectionAllowed,
  readEnv,
} = require('../config/env');
const {
  LIVE_ACCESS_REQUIREMENTS,
  LIVE_LIMIT_BOUNDS,
} = require('../automation/config');

const FIXTURE_DIR = path.join(__dirname, '..', 'extraction', 'fixtures');

function fixture(name) {
  return path.join(FIXTURE_DIR, name);
}

function readFixture(name) {
  return fs.readFileSync(fixture(name), 'utf8');
}

function assertConsistent(result) {
  assert.equal(
    result.totalRows,
    result.acceptedCount + result.rejectedCount + result.duplicateCount
  );
  assert.equal(result.acceptedCount, result.records.length);
  assert.equal(result.rejectedCount, result.rejectedRows.length);
  assert.equal(result.stats.totalRows, result.totalRows);
  assert.equal(result.stats.acceptedCount, result.acceptedCount);
  assert.equal(result.stats.rejectedCount, result.rejectedCount);
  assert.equal(result.stats.duplicateCount, result.duplicateCount);
  assert.equal(result.stats.countsConsistent, true);
}

function fakeClock(start = 1000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    wait: async (ms) => {
      current += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Rate limiting and backoff
// ---------------------------------------------------------------------------

test('rate limiter enforces a minimum interval between starts', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    minIntervalMs: 1000,
    now: clock.now,
    wait: clock.wait,
  });

  const first = await limiter.acquire();
  const second = await limiter.acquire();
  const third = await limiter.acquire();

  assert.equal(first.waitedMs, 0);
  assert.equal(second.waitedMs, 1000);
  assert.equal(third.waitedMs, 1000);
  assert.equal(limiter.snapshot().acquiredCount, 3);
  assert.equal(limiter.snapshot().totalWaitedMs, 2000);
});

test('rate limiter enforces a maximum per window', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    minIntervalMs: 0,
    maxRequestsPerWindow: 2,
    windowMs: 10_000,
    now: clock.now,
    wait: clock.wait,
  });

  await limiter.acquire();
  await limiter.acquire();
  const third = await limiter.acquire();

  assert.equal(third.waitedMs, 10_000);
  assert.equal(limiter.snapshot().acquiredCount, 3);
});

test('rate limiter rejects invalid configuration', () => {
  assert.throws(
    () => createRateLimiter({ minIntervalMs: -1 }),
    (error) => error.code === AUTOMATION_CODES.INVALID_OPTIONS
  );
  assert.throws(
    () => createRateLimiter({ maxRequestsPerWindow: 0 }),
    (error) => error.code === AUTOMATION_CODES.INVALID_OPTIONS
  );
});

test('backoff grows exponentially, caps and supports jitter', () => {
  const policy = createBackoffPolicy({
    baseDelayMs: 1000,
    factor: 2,
    maxDelayMs: 5000,
    jitterRatio: 0,
    maxRetries: 4,
  });

  assert.equal(policy.computeDelay(1).delayMs, 1000);
  assert.equal(policy.computeDelay(2).delayMs, 2000);
  assert.equal(policy.computeDelay(3).delayMs, 4000);
  assert.equal(policy.computeDelay(4).delayMs, 5000);
  assert.equal(policy.computeDelay(4).source, 'exponential');

  const jittered = createBackoffPolicy({
    baseDelayMs: 1000,
    jitterRatio: 0.5,
    random: () => 1,
    maxRetries: 1,
  }).computeDelay(1);

  assert.equal(jittered.delayMs, 500);
});

test('Retry-After seconds and HTTP dates are honored', () => {
  assert.equal(parseRetryAfter('120', 0), 120_000);
  assert.equal(parseRetryAfter(2, 0), 2000);
  assert.equal(parseRetryAfter('not-a-date', 0), null);
  assert.equal(parseRetryAfter(null, 0), null);

  // Pin the clock so the fixture date does not become a time bomb. Without an
  // injected clock, `computeDelay` uses the real `Date.now()` and any hard-coded
  // future date silently turns into a past date (delay clamped to 0).
  const now = Date.parse('2026-11-17T10:00:00Z');
  const policy = createBackoffPolicy({ maxDelayMs: 1000, now: () => now });

  const seconds = policy.computeDelay(1, '3');
  assert.equal(seconds.delayMs, 3000);
  assert.equal(seconds.source, 'retry-after');

  const date = parseRetryAfter('Tue, 17 Nov 2026 10:00:05 GMT', now);
  assert.equal(date, 5000);

  const excessive = policy.computeDelay(
    1,
    new Date(now + 600_000).toUTCString()
  );
  assert.equal(excessive.exceedsMaxRetryAfter, true);
});

test('backoff stops after maxRetries or a non-retryable error', () => {
  const policy = createBackoffPolicy({ maxRetries: 2 });
  assert.equal(policy.shouldRetry(1), true);
  assert.equal(policy.shouldRetry(2), false);
  assert.equal(
    policy.shouldRetry(1, { retryable: false }),
    false
  );
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

test('circuit breaker opens, probes half-open and closes on success', () => {
  const clock = fakeClock(0);
  const breaker = createCircuitBreaker({
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeoutMs: 1000,
    now: clock.now,
  });

  assert.equal(breaker.canRequest().allowed, true);
  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, 'closed');
  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, 'open');

  const blocked = breaker.canRequest();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.state, 'open');
  assert.equal(blocked.retryAfterMs, 1000);

  clock.advance(1000);
  assert.equal(breaker.canRequest().allowed, true);
  assert.equal(breaker.snapshot().state, 'half-open');

  breaker.recordSuccess();
  assert.equal(breaker.snapshot().state, 'half-open');
  breaker.recordSuccess();
  assert.equal(breaker.snapshot().state, 'closed');
});

test('circuit breaker reopens when a half-open probe fails', () => {
  const clock = fakeClock(0);
  const breaker = createCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 500,
    now: clock.now,
  });

  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, 'open');
  clock.advance(500);
  assert.equal(breaker.canRequest().allowed, true);
  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, 'open');
});

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

test('request monitor summarizes statuses, CAPTCHA, failures, durations and retries', () => {
  const monitor = createRequestMonitor({ now: () => 1000 });

  monitor.record({ url: 'https://example.test/a', status: 200, durationMs: 100 });
  monitor.record({
    url: 'https://example.test/b',
    status: 429,
    durationMs: 200,
    attempt: 2,
  });
  monitor.record({
    url: 'https://example.test/c',
    status: 403,
    durationMs: 300,
  });
  monitor.record({
    url: 'https://example.test/d',
    status: 200,
    outcome: 'captcha',
    captcha: true,
    captchaType: 'reCAPTCHA v2 checkbox',
    durationMs: 400,
  });
  monitor.record({
    url: 'https://example.test/e',
    outcome: 'timeout',
    errorCode: 'ETIMEDOUT',
    durationMs: 500,
  });
  monitor.record({
    url: 'https://example.test/f',
    outcome: 'connection_error',
    errorCode: 'ECONNRESET',
  });

  const summary = monitor.summary();
  assert.equal(summary.totalRequests, 6);
  assert.equal(summary.statusCounts['200'], 2);
  assert.equal(summary.http403Count, 1);
  assert.equal(summary.http429Count, 1);
  assert.equal(summary.captchaCount, 1);
  assert.equal(summary.timeoutCount, 1);
  assert.equal(summary.connectionFailureCount, 1);
  assert.equal(summary.retryCount, 1);
  assert.equal(summary.retriedRequests, 1);
  assert.equal(summary.durationMs.count, 5);
  assert.equal(summary.durationMs.min, 100);
  assert.equal(summary.durationMs.max, 500);
  assert.equal(summary.durationMs.avg, 300);
  assert.equal(summary.durationMs.p50, 300);
  assert.ok(summary.firstTimestamp);
  assert.ok(summary.lastTimestamp);
  assert.equal(summary.eventsRetained, 6);
});

test('request monitor retains only the configured number of events', () => {
  const monitor = createRequestMonitor({ maxEvents: 2 });

  monitor.record({ status: 200 });
  monitor.record({ status: 201 });
  monitor.record({ status: 202 });

  assert.equal(monitor.summary().totalRequests, 2);
  assert.deepEqual(
    monitor.getEvents().map((event) => event.status),
    [201, 202]
  );
  assert.equal(monitor.recent(1).length, 1);
});

test('error monitor classifies timeouts, connection, DNS, TLS, 403 and 429', () => {
  assert.equal(
    classifyError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))
      .category,
    ERROR_CATEGORIES.TIMEOUT
  );
  assert.equal(
    classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .category,
    ERROR_CATEGORIES.CONNECTION
  );
  assert.equal(
    classifyError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))
      .category,
    ERROR_CATEGORIES.DNS
  );
  assert.equal(
    classifyError(new Error('certificate has expired')).category,
    ERROR_CATEGORIES.TLS
  );
  assert.equal(
    classifyError(new Error('forbidden'), { status: 403 }).category,
    ERROR_CATEGORIES.ACCESS_DENIED
  );
  assert.equal(
    classifyError(new Error('too many'), { status: 429 }).category,
    ERROR_CATEGORIES.RATE_LIMITED
  );
  assert.equal(
    classifyError(
      Object.assign(new Error('header mismatch'), {
        name: 'ExtractionError',
        code: 'HEADER_MISMATCH',
      })
    ).category,
    ERROR_CATEGORIES.EXTRACTION
  );
});

test('error monitor records, summarizes and redacts stacks by default', () => {
  const monitor = createErrorMonitor({ now: () => 1000 });

  monitor.record(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
  monitor.record(new Error('forbidden'), { status: 403 });

  const summary = monitor.summary();
  assert.equal(summary.totalErrors, 2);
  assert.equal(summary.retryableCount, 1);
  assert.equal(summary.categoryCounts.timeout, 1);
  assert.equal(summary.categoryCounts.access_denied, 1);
  assert.equal(monitor.recent(5)[1].stack, null);
});

test('IP monitor recommends stop on denial signals and never rotates', () => {
  const monitor = createIpMonitor({
    denialThreshold: 2,
    rateLimitThreshold: 1,
    captchaThreshold: 1,
  });

  monitor.observe({ ip: '203.0.113.10', status: 200 });
  assert.equal(monitor.shouldStop('203.0.113.10'), false);

  monitor.observe({ ip: '203.0.113.10', status: 403 });
  monitor.observe({ ip: '203.0.113.10', status: 403 });

  const status = monitor.getStatus('203.0.113.10');
  assert.equal(status.http403Count, 2);
  assert.equal(status.suspectedBlock, true);
  assert.equal(monitor.summary().recommendation, 'stop');
  assert.equal(monitor.summary().rotationImplemented, false);
  assert.equal(monitor.summary().ipDiscoveryImplemented, false);
});

// ---------------------------------------------------------------------------
// Page handler and ARRT adapter
// ---------------------------------------------------------------------------

test('CAPTCHA detection identifies the observed reCAPTCHA v2 checkbox', () => {
  const html = `
    <form id="searchForm">
      <div class="g-recaptcha" data-sitekey="${ARRT_OBSERVED.captcha.siteKey}"></div>
    </form>
    <script src="https://www.google.com/recaptcha/api.js" async defer></script>
  `;

  const detection = detectCaptchaInHtml(html, { url: ARRT_OBSERVED.pageUrl });
  assert.equal(detection.present, true);
  assert.equal(detection.provider, 'google-recaptcha');
  assert.equal(detection.type, 'reCAPTCHA v2 checkbox');
  assert.equal(detection.siteKey, ARRT_OBSERVED.captcha.siteKey);
  assert.equal(detection.requiresInteraction, true);
  assert.ok(detection.evidence.length >= 3);
});

test('CAPTCHA detection distinguishes invisible widgets and absent widgets', () => {
  const invisible = detectCaptchaInHtml(
    '<div class="g-recaptcha" data-sitekey="abc" data-size="invisible"></div>'
  );
  assert.equal(invisible.type, 'reCAPTCHA v2 invisible');
  assert.equal(invisible.requiresInteraction, false);

  const absent = detectCaptchaInHtml('<form><input name="x"></form>');
  assert.equal(absent.present, false);
  assert.equal(absent.provider, null);
});

test('page handler reads HTML, status and detects CAPTCHA without solving', async () => {
  let current = 0;
  const html = '<div class="g-recaptcha" data-sitekey="abc"></div>';

  const page = {
    url: () => 'https://example.test/verify',
    async goto() {
      return { status: () => 200 };
    },
    async content() {
      return html;
    },
    async click(selector) {
      this.clicked = selector;
    },
    async type(selector, value) {
      this.typed = [selector, value];
    },
    async waitForSelector(selector, options) {
      return { selector, options };
    },
  };

  const handler = createPageHandler({
    page,
    now: () => (current += 10),
  });

  const navigation = await handler.goto('https://example.test/verify', {
    timeoutMs: 1000,
  });
  assert.equal(navigation.status, 200);
  assert.equal(navigation.durationMs, 10);

  await handler.fill('#firstname', 'Alice');
  assert.deepEqual(page.typed, ['#firstname', 'Alice']);

  const detection = await handler.detectCaptcha();
  assert.equal(detection.present, true);
  assert.equal(detection.siteKey, 'abc');
});

test('ARRT adapter analyzes the observed page shape offline', () => {
  const adapter = createArrtAdapter();
  const analysis = adapter.analyzePage(`
    <form id="searchForm">
      <input id="firstname" name="firstname" minlength="1">
      <input id="lastname" name="lastname" minlength="2">
      <div class="g-recaptcha" data-sitekey="${ARRT_OBSERVED.captcha.siteKey}"></div>
      <input id="submitButton" type="submit">
    </form>
    <div id="searchList"></div>
    <input name="__RequestVerificationToken" type="hidden" value="token">
    <script>
      var VerifyCredentialsSearchByNameUrl = "/VerifyCredentials/SearchByName";
      var VerifyCredentialsGetDisplayDetailsUrl = "/VerifyCredentials/GetDisplayDetails";
    </script>
  `);

  assert.equal(analysis.captcha.present, true);
  assert.equal(analysis.captcha.type, 'reCAPTCHA v2 checkbox');
  assert.equal(analysis.observed.searchForm, true);
  assert.equal(analysis.observed.firstNameInput, true);
  assert.equal(analysis.observed.lastNameInput, true);
  assert.equal(analysis.observed.antiforgeryField, true);
  assert.equal(analysis.observed.searchEndpointVisible, true);
  assert.equal(analysis.schema.searchConstraints.lastNameMinLength, 2);
});

test('ARRT adapter reuses the extraction engine for offline result HTML', () => {
  const adapter = createArrtAdapter();
  const result = adapter.parseResultsHtml(readFixture('normal.html'));

  assert.equal(result.totalRows, 4);
  assert.equal(result.acceptedCount, 4);
  assert.equal(result.records[0].fullName, 'Alice Smith');
});

test('ARRT adapter refuses live fetch without authorization or CAPTCHA approval', async () => {
  const noAuth = createArrtAdapter();
  await assert.rejects(noAuth.fetchPage({ firstName: 'A', lastName: 'B' }), {
    code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
  });

  const authorized = createArrtAdapter({
    authorization: { confirmed: true, reference: 'test-approval' },
  });
  await assert.rejects(
    authorized.fetchPage({ firstName: 'A', lastName: 'B' }),
    { code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL }
  );

  const captchaApproved = createArrtAdapter({
    authorization: { confirmed: true, reference: 'test-approval' },
    captcha: { approved: true, approvalReference: 'test-captcha-approval' },
  });
  await assert.rejects(
    captchaApproved.fetchPage({ firstName: 'A', lastName: 'B' }),
    { code: AUTOMATION_CODES.BROWSER_UNAVAILABLE }
  );
});

// ---------------------------------------------------------------------------
// Browser and session scaffolding
// ---------------------------------------------------------------------------

test('browser service uses an injected Puppeteer module and closes pages', async () => {
  const fakePage = {
    closed: false,
    async close() {
      this.closed = true;
    },
  };
  const fakeBrowser = {
    closed: false,
    launched: null,
    async newPage() {
      return fakePage;
    },
    async close() {
      this.closed = true;
    },
  };
  let launchOptions = null;
  const service = createBrowserService({
    headless: false,
    puppeteerModule: {
      async launch(options) {
        launchOptions = options;
        return fakeBrowser;
      },
    },
  });

  const page = await service.withPage(async (activePage) => {
    assert.equal(activePage, fakePage);
    return 'ok';
  });

  assert.equal(page, 'ok');
  assert.equal(fakePage.closed, true);
  assert.equal(launchOptions.headless, false);
  assert.equal(service.snapshot().launched, true);
  assert.equal(service.snapshot().stealthApplied, false);
  assert.equal(await service.close(), true);
  assert.equal(fakeBrowser.closed, true);
});

test('browser service reports a missing Puppeteer module clearly', async () => {
  const service = createBrowserService({
    moduleName: 'definitely-not-installed-puppeteer-module',
  });

  await assert.rejects(service.launch(), {
    code: AUTOMATION_CODES.BROWSER_UNAVAILABLE,
  });
});

test('session manager tracks pages, requests and stop state', async () => {
  const session = createSessionManager({
    pageFactory: async () => ({ id: 'page-1' }),
    now: () => 1000,
  });

  await session.start();
  const page = await session.getPage();
  session.recordRequest({ timestamp: '2026-11-17T10:00:00.000Z' });
  await session.stop(STOP_REASONS.PLAN_EXHAUSTED);
  const snapshot = await session.close();

  assert.equal(page.id, 'page-1');
  assert.equal(snapshot.status, 'closed');
  assert.equal(snapshot.pagesOpened, 1);
  assert.equal(snapshot.requestCount, 1);
  assert.equal(snapshot.stopReason, STOP_REASONS.PLAN_EXHAUSTED);

  await assert.rejects(session.start(), {
    code: AUTOMATION_CODES.INVALID_OPTIONS,
  });
});

// ---------------------------------------------------------------------------
// Provider contract and mock provider
// ---------------------------------------------------------------------------

test('provider contract validates required fields and result HTML', () => {
  assert.throws(
    () => assertProvider({}),
    (error) => error.code === AUTOMATION_CODES.PROVIDER_CONTRACT
  );

  assert.throws(
    () =>
      normalizeProviderResult({
        html: '',
        status: 200,
      }),
    (error) => error.code === AUTOMATION_CODES.PROVIDER_CONTRACT
  );

  const normalized = normalizeProviderResult({
    html: '<p>ok</p>',
    status: 200,
  });
  assert.equal(normalized.status, 200);
});

test('mock provider is deterministic, offline and reports fixture calls', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html', 'page-1.html'],
  });

  assert.equal(provider.mode, PROVIDER_MODES.MOCK);
  assert.equal(provider.requiresBrowser, false);
  assert.equal(provider.snapshot().fixtures[0], 'normal.html');

  const first = await provider.fetchPage(
    { firstName: 'A', lastName: 'B' },
    { searchIndex: 0, attempt: 1 }
  );
  const second = await provider.fetchPage(
    { firstName: 'C', lastName: 'D' },
    { searchIndex: 1, attempt: 1 }
  );

  assert.match(first.html, /Alice\s+Smith/);
  assert.match(second.html, /Cross Page Person/);
  assert.equal(provider.getCalls().length, 2);
});

// ---------------------------------------------------------------------------
// Collection service
// ---------------------------------------------------------------------------

test('collection reuses extraction, dedupes across pages and reports monitors', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html', 'page-1.html', 'page-2.html'],
  });

  const result = await collectRecords(
    [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Cross', lastName: 'Person' },
      { firstName: 'Second', lastName: 'Person' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.stopReason, STOP_REASONS.PLAN_EXHAUSTED);
  assert.equal(result.totalRows, 8);
  assert.equal(result.acceptedCount, 7);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.stats.crossPageDuplicateCount, 1);
  assert.equal(result.stats.pagesCollected, 3);
  assert.equal(result.stats.requests, 3);
  assert.equal(result.stats.monitoring.requests.http429Count, 0);
  assert.equal(result.stats.monitoring.errors.totalErrors, 0);
  assert.equal(result.stats.target.reached, true);
  assert.equal(result.stats.provider.mode, 'mock');
  assertConsistent(result);
});

test('collection counts within-page duplicates separately', async () => {
  const provider = createMockProvider({ fixtures: ['duplicates.html'] });

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.totalRows, 4);
  assert.equal(result.acceptedCount, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.stats.withinPageDuplicateCount, 1);
  assert.equal(result.stats.crossPageDuplicateCount, 0);
  assertConsistent(result);
});

test('collection stops immediately on CAPTCHA detection', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [
      [
        {
          captcha: {
            present: true,
            type: 'reCAPTCHA v2 checkbox',
            siteKey: ARRT_OBSERVED.captcha.siteKey,
          },
        },
      ],
    ],
  });

  const result = await collectRecords(
    [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Bob', lastName: 'Jones' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 2,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, STOP_REASONS.CAPTCHA_DETECTED);
  assert.equal(result.stats.monitoring.requests.captchaCount, 1);
  assert.equal(result.stats.monitoring.requests.totalRequests, 1);
  assert.equal(result.stats.searchesAttempted, 1);
  assert.equal(result.stats.monitoring.ip.recommendation, 'stop');
});

test('collection retries HTTP 429 using Retry-After and then succeeds', async () => {
  const delays = [];
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [
      [
        { status: 429, headers: { 'retry-after': '2' } },
        { fixture: 'normal.html' },
      ],
    ],
  });

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 1,
      wait: async (ms) => {
        delays.push(ms);
      },
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.acceptedCount, 4);
  assert.equal(result.stats.requests, 2);
  assert.equal(result.stats.retries, 1);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.stats.monitoring.requests.http429Count, 1);
  assert.equal(result.stats.monitoring.requests.statusCounts['200'], 1);
  assertConsistent(result);
});

test('collection retries timeouts and records both outcomes', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [[{ timeout: true }, { fixture: 'normal.html' }]],
  });

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 1,
      wait: async () => undefined,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.acceptedCount, 4);
  assert.equal(result.stats.requests, 2);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.monitoring.requests.timeoutCount, 1);
  assert.equal(result.stats.monitoring.errors.totalErrors, 1);
});

test('collection stops on HTTP 403 by default', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [[{ status: 403 }]],
  });

  const result = await collectRecords(
    [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Bob', lastName: 'Jones' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 2,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, STOP_REASONS.ACCESS_DENIED);
  assert.equal(result.stats.requests, 1);
  assert.equal(result.stats.monitoring.requests.http403Count, 1);
  assert.equal(result.stats.monitoring.ip.recommendation, 'stop');
});

test('collection can skip a denied search when stopOnAccessDenial is false', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [[{ status: 403 }], [{ fixture: 'normal.html' }]],
  });

  const result = await collectRecords(
    [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Bob', lastName: 'Jones' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      stopOnAccessDenial: false,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.stopReason, STOP_REASONS.PLAN_EXHAUSTED);
  assert.equal(result.stats.searchesSkipped, 1);
  assert.equal(result.acceptedCount, 4);
});

test('collection stops when the circuit breaker opens', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html'],
    script: [
      [
        { error: 'transient failure', retryable: true },
        { fixture: 'normal.html' },
      ],
    ],
  });

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 2,
      wait: async () => undefined,
      circuitBreakerOptions: {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      },
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, STOP_REASONS.CIRCUIT_OPEN);
  assert.equal(result.stats.circuitBreaker.state, 'open');
  assert.equal(result.stats.requests, 1);
});

test('collection enforces request and target limits', async () => {
  const provider = createMockProvider({
    fixtures: ['normal.html', 'page-1.html', 'page-2.html'],
  });

  const limited = await collectRecords(
    [
      { firstName: 'A', lastName: 'B' },
      { firstName: 'C', lastName: 'D' },
      { firstName: 'E', lastName: 'F' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      maxRequests: 1,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(limited.stopReason, STOP_REASONS.REQUEST_LIMIT_EXCEEDED);
  assert.equal(limited.stats.requests, 1);

  const targeted = await collectRecords(
    [
      { firstName: 'A', lastName: 'B' },
      { firstName: 'C', lastName: 'D' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 1 },
    }
  );

  assert.equal(targeted.stopReason, STOP_REASONS.TARGET_REACHED);
  assert.equal(targeted.stats.requests, 1);
  assert.equal(targeted.stats.target.maxReached, true);
});

test('collection stops on extraction failure and keeps the page error', async () => {
  const provider = createMockProvider({
    fixtures: ['mismatched-headers.html'],
  });

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, STOP_REASONS.EXTRACTION_FAILED);
  assert.equal(result.totalRows, 0);
  assert.equal(result.stats.extraction.pageErrors.length, 1);
  assert.equal(result.stats.monitoring.errors.categoryCounts.extraction_failure, 1);
});

test('collection rejects empty plans and invalid targets', async () => {
  const provider = createMockProvider({ fixtures: ['normal.html'] });

  await assert.rejects(collectRecords([], { provider }), {
    code: AUTOMATION_CODES.NO_SEARCHES,
  });

  await assert.rejects(
    collectRecords([{ firstName: 'A', lastName: 'B' }], {
      provider,
      target: { min: 10, max: 1 },
    }),
    (error) => error.code === AUTOMATION_CODES.INVALID_OPTIONS
  );

  await assert.rejects(
    collectRecords([{ firstName: '', lastName: 'B' }], { provider }),
    (error) => error.code === AUTOMATION_CODES.INVALID_OPTIONS
  );
});

test('collection refuses a live provider without explicit authorization', async () => {
  const adapter = createArrtAdapter({
    authorization: { confirmed: true, reference: 'test-approval' },
  });

  await assert.rejects(
    collectRecords([{ firstName: 'Alice', lastName: 'Smith' }], {
      provider: adapter,
    }),
    { code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED }
  );

  const result = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider: adapter,
      allowLiveProvider: true,
      authorization: { confirmed: true, reference: 'test-approval' },
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, STOP_REASONS.CAPTCHA_DETECTED);
  assert.equal(result.stats.monitoring.requests.captchaCount, 0);
  assert.equal(
    result.stats.monitoring.errors.categoryCounts.captcha,
    1
  );
  assert.equal(result.stats.requests, 1);

  const unconfigured = await collectRecords(
    [{ firstName: 'Alice', lastName: 'Smith' }],
    {
      provider: createArrtAdapter(),
      allowLiveProvider: true,
      authorization: { confirmed: true, reference: 'test-approval' },
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
    }
  );

  assert.equal(unconfigured.stopReason, STOP_REASONS.AUTHORIZATION_REQUIRED);
});

test('default configuration records conservative limits and target size', () => {
  const config = createDefaultConfig();

  assert.equal(config.target.min, DEFAULT_TARGET_RECORDS.min);
  assert.equal(config.target.max, DEFAULT_TARGET_RECORDS.max);
  assert.equal(config.stopOnAccessDenial, true);
  assert.equal(config.stopOnCaptcha, true);
  assert.equal(config.request.minIntervalMs, 5000);
  assert.equal(config.request.maxRequests, 100);
  assert.equal(
    new AutomationError('x', { code: AUTOMATION_CODES.INVALID_OPTIONS })
      .retryable,
    false
  );
});

function authorizedEnv(overrides = {}) {
  return {
    LIVE_AUTHORIZATION_CONFIRMED: 'true',
    LIVE_AUTHORIZATION_REFERENCE: 'AUTH-PHASE1-TEST',
    LIVE_AUTHORIZATION_SCOPE: 'ARRT_VERIFY_CREDENTIALS,SUPERVISED_RUN',
    LIVE_CAPTCHA_APPROVED: 'true',
    LIVE_CAPTCHA_APPROVAL_REFERENCE: 'CAPTCHA-PHASE1-TEST',
    LIVE_MAX_RECORDS_PER_JOB: '350',
    LIVE_MAX_SEARCHES_PER_JOB: '100',
    LIVE_MAX_JOBS_PER_DAY: '10',
    LIVE_BROWSER_HEADLESS: 'false',
    ...overrides,
  };
}

test('readEnv defaults keep every live gate disabled', () => {
  const config = readEnv({});

  assert.equal(config.live.authorization.confirmed, false);
  assert.equal(config.live.authorization.reference, null);
  assert.deepEqual(config.live.authorization.scope, []);
  assert.equal(config.live.captcha.approved, false);
  assert.equal(config.live.captcha.approvalReference, null);
  assert.equal(config.live.limits.maxRecordsPerJob, null);
  assert.equal(config.live.limits.maxSearchesPerJob, null);
  assert.equal(config.live.limits.maxJobsPerDay, null);
  assert.equal(config.live.browser.headless, false);
  assert.throws(() => assertLiveCollectionAllowed(config), {
    code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
  });
});

test('missing or partial written authorization blocks live execution', () => {
  const base = authorizedEnv();

  assert.throws(
    () => assertLiveCollectionAllowed(readEnv({})),
    { code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED }
  );

  assert.throws(
    () => assertLiveCollectionAllowed(readEnv({ ...base, LIVE_AUTHORIZATION_CONFIRMED: 'false' })),
    { code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED }
  );

  const missingReference = readEnv({ ...base, LIVE_AUTHORIZATION_REFERENCE: '' });
  assert.throws(
    () => assertLiveCollectionAllowed(missingReference),
    (error) =>
      error.code === AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED &&
      error.details.required.includes('LIVE_AUTHORIZATION_REFERENCE')
  );

  const missingScope = readEnv({ ...base, LIVE_AUTHORIZATION_SCOPE: '' });
  assert.throws(
    () => assertLiveCollectionAllowed(missingScope),
    (error) =>
      error.code === AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED &&
      error.details.required.includes('LIVE_AUTHORIZATION_SCOPE')
  );
});

test('missing manual CAPTCHA approval blocks live execution', () => {
  const base = authorizedEnv();

  assert.throws(
    () => assertLiveCollectionAllowed(readEnv({ ...base, LIVE_CAPTCHA_APPROVED: 'false' })),
    {
      code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL,
    }
  );

  const missingReference = readEnv({
    ...base,
    LIVE_CAPTCHA_APPROVAL_REFERENCE: '',
  });
  assert.throws(
    () => assertLiveCollectionAllowed(missingReference),
    (error) =>
      error.code === AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL &&
      error.details.required.includes('LIVE_CAPTCHA_APPROVAL_REFERENCE')
  );
});

test('missing or invalid permitted collection limits block live execution', () => {
  const config = readEnv(authorizedEnv());

  const withLimits = (limits) => ({
    ...config,
    live: { ...config.live, limits: { ...config.live.limits, ...limits } },
  });

  for (const limits of [
    { maxRecordsPerJob: null },
    { maxSearchesPerJob: null },
    { maxJobsPerDay: null },
    { maxRecordsPerJob: 0 },
    { maxSearchesPerJob: -1 },
    { maxJobsPerDay: 1.5 },
    { maxRecordsPerJob: LIVE_LIMIT_BOUNDS.maxRecordsPerJob + 1 },
  ]) {
    assert.throws(
      () => assertLiveCollectionAllowed(withLimits(limits)),
      { code: AUTOMATION_CODES.COLLECTION_LIMIT_EXCEEDED },
      JSON.stringify(limits)
    );
  }
});

test('headless live execution is rejected for supervised operation', () => {
  const config = readEnv(authorizedEnv({ LIVE_BROWSER_HEADLESS: 'true' }));

  assert.equal(LIVE_ACCESS_REQUIREMENTS.requireVisibleBrowser, true);
  assert.throws(() => assertLiveCollectionAllowed(config), {
    code: AUTOMATION_CODES.INVALID_OPTIONS,
  });
});

test('requested targets and search plans are checked against permitted limits', () => {
  const config = readEnv(authorizedEnv());

  assert.throws(
    () =>
      assertLiveCollectionAllowed(config, {
        requestedTarget: config.live.limits.maxRecordsPerJob + 1,
      }),
    { code: AUTOMATION_CODES.COLLECTION_LIMIT_EXCEEDED }
  );

  assert.throws(
    () =>
      assertLiveCollectionAllowed(config, {
        plannedSearches: config.live.limits.maxSearchesPerJob + 1,
      }),
    { code: AUTOMATION_CODES.COLLECTION_LIMIT_EXCEEDED }
  );

  assert.doesNotThrow(() =>
    assertLiveCollectionAllowed(config, {
      requestedTarget: 300,
      plannedSearches: 26,
    })
  );
});

test('a fully authorized configuration returns a frozen approval snapshot', () => {
  const snapshot = assertLiveCollectionAllowed(readEnv(authorizedEnv()));

  assert.equal(snapshot.authorization.confirmed, true);
  assert.equal(snapshot.authorization.reference, 'AUTH-PHASE1-TEST');
  assert.deepEqual(snapshot.authorization.scope, [
    'ARRT_VERIFY_CREDENTIALS',
    'SUPERVISED_RUN',
  ]);
  assert.equal(snapshot.captcha.approved, true);
  assert.equal(snapshot.limits.maxRecordsPerJob, 350);
  assert.equal(snapshot.browser.headless, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('malformed live configuration values are rejected when read', () => {
  assert.throws(
    () => readEnv(authorizedEnv({ LIVE_AUTHORIZATION_CONFIRMED: 'yes' })),
    /LIVE_AUTHORIZATION_CONFIRMED must be "true" or "false"/
  );

  assert.throws(
    () => readEnv(authorizedEnv({ LIVE_MAX_RECORDS_PER_JOB: 'zero' })),
    /LIVE_MAX_RECORDS_PER_JOB must be a positive integer/
  );

  assert.throws(
    () => readEnv(authorizedEnv({ LIVE_MAX_JOBS_PER_DAY: '1000000' })),
    /LIVE_MAX_JOBS_PER_DAY cannot exceed/
  );
});

test('disabled live gates prevent any live provider fetch', async () => {
  const adapter = createArrtAdapter();
  let fetchCalls = 0;
  const provider = {
    ...adapter,
    async fetchPage(...args) {
      fetchCalls += 1;
      return adapter.fetchPage(...args);
    },
  };

  assert.throws(() => assertLiveCollectionAllowed(readEnv({})), {
    code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
  });

  await assert.rejects(
    collectRecords([{ firstName: 'Alice', lastName: 'Smith' }], { provider }),
    { code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED }
  );

  assert.equal(fetchCalls, 0);
});
