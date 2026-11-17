# Automation Architecture — ARRT Credential Verification

**Status:** scaffolding implemented and verified offline; live ARRT access disabled  
**Date:** 2026-11-17  
**Node:** 22.20.0 (declared minimum 18.17+)

---

## 1. Purpose and boundaries

This phase prepares a modular collection pipeline for the ARRT Verify
Credentials search page while keeping live access impossible until written
authorization and an approved CAPTCHA procedure exist.

Implemented:

- a provider contract and deterministic offline mock provider;
- request pacing, exponential backoff, `Retry-After` handling and a circuit
  breaker;
- request, error and egress-identity monitoring;
- CAPTCHA detection that stops the run;
- a session manager and a lazy Puppeteer wrapper;
- an inert ARRT adapter that reuses the Step 2 extraction engine;
- collection orchestration with target, retry, request-cap and stop rules;
- an offline demo and 37 automation tests.

Deliberately **not** implemented:

- live ARRT search requests;
- CAPTCHA solving, token injection or `grecaptcha` manipulation;
- stealth plugins, fingerprint spoofing or automation hiding;
- proxy rotation, IP switching or IP discovery;
- pagination crawling against ARRT;
- database, API server or frontend.

---

## 2. Directory layout

```text
backend/src/automation/
├── arrt.adapter.js              # Observed ARRT constants + inert live gate
├── backoff.js                   # Exponential backoff, jitter, Retry-After
├── browser.service.js           # Lazy Puppeteer lifecycle (not installed)
├── circuit-breaker.js           # closed / open / half-open
├── collection.service.js        # Orchestration and reporting
├── config.js                    # Conservative defaults, merge/freeze
├── demo.js                      # Offline mock-provider demo
├── errors.js                    # Automation error taxonomy
├── index.js                     # Public automation barrel
├── page-handler.js              # Navigation/form helpers + CAPTCHA detection
├── rate-limiter.js              # Min interval and rolling-window cap
├── session.manager.js           # Session/page/request bookkeeping
├── monitoring/
│   ├── request-monitor.js       # Status, duration, CAPTCHA, retry telemetry
│   ├── error-monitor.js         # Error classification and summaries
│   └── ip-monitor.js            # Denial tracking; no rotation
└── providers/
    ├── data-source.provider.js  # Provider contract and normalization
    └── mock.provider.js         # Deterministic fixture provider
```

Tests: `backend/src/tests/automation.test.js`  
Public exports: `backend/src/index.js` spreads the automation barrel alongside
Step 1 and Step 2.

---

## 3. Data flow

```text
search plan
   │
   ▼
collectRecords()
   │  target check / request cap / circuit check
   ▼
rateLimiter.acquire()
   │
   ▼
provider.fetchPage(search, context)
   │
   ├── mock.provider.js  → local synthetic fixture HTML
   └── arrt.adapter.js   → refuses (authorization / CAPTCHA gates)
   │
   ▼
normalizeProviderResult()
   │
   ├── CAPTCHA?      → record + stop (or skip when stopOnCaptcha=false)
   ├── HTTP 403?     → record + stop (or skip when stopOnAccessDenial=false)
   ├── HTTP 429?     → record + backoff/Retry-After → retry or stop
   ├── timeout/conn? → record + retry or stop
   └── success       → record success
   │
   ▼
extractRecords()          ← existing Step 2 engine, unchanged
   │
   ▼
cross-page duplicate tracker
   │
   ▼
collection report
   ├── records / rejectedRows / counts
   ├── per-page reports and page errors
   ├── duplicate diagnostics
   ├── request/error/IP monitor summaries
   └── rate limiter, backoff, circuit breaker, session snapshots
```

---

## 4. Module responsibilities

| Module | Responsibility |
| --- | --- |
| `collection.service.js` | Runs the plan, applies limits, handles retries and stop reasons, aggregates counts and monitors. |
| `providers/data-source.provider.js` | Validates `{ id, mode, requiresBrowser, fetchPage }` and normalizes provider results. |
| `providers/mock.provider.js` | Cycles local synthetic fixtures; supports scripted errors, timeouts, 403/429 statuses and CAPTCHA markers. Never uses the network. |
| `arrt.adapter.js` | Encodes observed page facts (selectors, endpoint paths, CAPTCHA site key, 424 behavior). Provides offline `analyzePage()` / `parseResultsHtml()`. Live `fetchPage()` is gated. |
| `page-handler.js` | `goto`, `content`, `fill`, `click`, `waitForSelector`, response status; detects reCAPTCHA / hCaptcha / Turnstile from static HTML. |
| `browser.service.js` | Lazily `require('puppeteer')`; returns `BROWSER_UNAVAILABLE` when absent. No stealth or evasion flags. |
| `session.manager.js` | Tracks active/closed state, pages opened, requests, stop reason; optionally owns a browser service. |
| `rate-limiter.js` | Serializes starts; enforces a minimum interval and an optional rolling-window request cap. |
| `backoff.js` | Exponential growth with cap and jitter; parses `Retry-After` seconds or HTTP dates. |
| `circuit-breaker.js` | Opens after repeated failures, probes half-open, closes after successes; blocks work rather than evading. |
| `request-monitor.js` | Per-request observation and percentile summaries. |
| `error-monitor.js` | Error classification, category/code counts, stack redaction by default. |
| `ip-monitor.js` | Groups observations by caller-supplied label; recommends stop on denials/CAPTCHA. No discovery or rotation. |
| `config.js` | Internal safety defaults, deep-frozen config merging. |
| `errors.js` | `AutomationError` and stable codes. |
| `demo.js` | Offline end-to-end run over fixtures. |

---

## 5. Provider contract

```js
{
  id: 'mock-fixtures',
  mode: 'mock',            // 'mock' | 'live'
  requiresBrowser: false,
  async fetchPage(search, context) {
    return {
      html: '<table>...</table>',  // required, non-empty for 2xx
      status: 200,                 // optional, defaults to 200
      url: 'mock://search/1',
      fixture: 'normal.html',      // provenance, optional
      sourceUrl: 'mock://search/1',// provenance, optional
      captcha: null,               // or { present, type?, siteKey? }
      headers: {},                 // e.g. { 'retry-after': '120' }
      pageNumber: 1
    };
  }
}
```

Rules enforced by `normalizeProviderResult()`:

- `html` must be a string; it must be non-empty for non-error statuses.
- `status` must be an integer HTTP status (100–599) when supplied.
- `captcha` must be `null` or an object with a boolean `present`.
- Extra provenance fields are preserved.

The provider never writes records and never bypasses access controls.

---

## 6. Collection semantics

### 6.1 Counts

```text
totalRows = acceptedCount + rejectedCount + duplicateCount
```

- `acceptedCount` = length of `records`;
- `rejectedCount` = length of `rejectedRows`;
- `duplicateCount` = within-page duplicates + cross-page duplicates;
- ignored rows (for example `No results found.`) are reported separately and
  are not part of `totalRows`.

`stats.countsConsistent` is computed from these values, not hard-coded.

### 6.2 Stop reasons

| Reason | Meaning |
| --- | --- |
| `PLAN_EXHAUSTED` | All search combinations were handled. |
| `TARGET_REACHED` | Accepted records reached `target.max` (checked between searches). |
| `REQUEST_LIMIT_EXCEEDED` | `maxRequests` reached. |
| `ACCESS_DENIED` | HTTP 403 (default stop). |
| `RATE_LIMITED` | HTTP 429 after retry handling. |
| `CAPTCHA_DETECTED` | CAPTCHA found on a page or provider error. |
| `CIRCUIT_OPEN` | Circuit breaker refused the next request. |
| `REQUEST_TIMEOUT` | Timeout with retries exhausted. |
| `PROVIDER_ERROR` | Non-retryable provider/HTTP failure. |
| `AUTHORIZATION_REQUIRED` | A live provider gate rejected the run. |
| `EXTRACTION_FAILED` | The Step 2 engine rejected the page. |

`status` is `completed` for `PLAN_EXHAUSTED` / `TARGET_REACHED`, otherwise
`stopped`.

### 6.3 Target behavior

- Target is expressed as accepted records: default `{ min: 300, max: 350 }`.
- The target is checked **between searches**, not inside a result page.
- One page can therefore overshoot `target.max`; this is expected.
- The 300–350 value is a project goal, not an ARRT limit.

### 6.4 Retry behavior

- Timeouts, connection failures, 429 and retryable provider errors are retried
  up to `maxRetries` (default 2).
- `Retry-After` overrides exponential delay.
- A `Retry-After` longer than `maxRetryAfterMs` stops the run rather than
  retrying early.
- 403 and CAPTCHA are not retried.

---

## 7. Recovery controls

### 7.1 Rate limiter

- `minIntervalMs` (default 5,000 ms) between request starts.
- Optional `maxRequestsPerWindow` / `windowMs` (window default 60,000 ms).
- Calls are serialized so concurrent callers cannot exceed the configured rate.
- The limiter paces work; it does not discover endpoints or evade controls.

### 7.2 Backoff

```text
delay = min(baseDelay * factor^(attempt-1), maxDelay)
with optional multiplicative jitter
```

Defaults: base 2,000 ms, factor 2, cap 60,000 ms, jitter 0.2.

### 7.3 Circuit breaker

| State | Behavior |
| --- | --- |
| `closed` | Requests allowed; failures counted. |
| `open` | Requests blocked until `resetTimeoutMs`. |
| `half-open` | Limited probes; success closes, failure reopens. |

Default: open after 3 consecutive failures, close after 2 half-open successes,
reset timeout 60 s.

---

## 8. Monitoring

### 8.1 Request monitor

Records status, duration, attempt/retry count, outcome, CAPTCHA presence/type,
error code and optional IP label. Summaries include:

- `statusCounts`, `http403Count`, `http429Count`, `http4xxCount`,
  `http5xxCount`;
- `captchaCount`, `timeoutCount`, `connectionFailureCount`;
- `retryCount`, `retriedRequests`;
- duration `count/min/max/avg/p50/p95`;
- first/last timestamps and retained-event count.

### 8.2 Error monitor

Classifies errors into operational categories and reports counts by category
and code. Stack traces are excluded unless `includeStack: true`.

### 8.3 Egress identity monitor

- Accepts only a caller-supplied `ipLabel`.
- Defaults to `unattributed`.
- Flags `suspectedBlock` on 403, repeated 429 or CAPTCHA.
- Reports `rotationImplemented: false` and `ipDiscoveryImplemented: false`.

---

## 9. Safety gates

Live work requires **all** of the following:

1. `provider.mode === 'live'`;
2. `allowLiveProvider: true`;
3. `authorization.confirmed: true` with a non-empty reference;
4. the provider itself must permit the request;
5. for the ARRT adapter, a CAPTCHA approval with a reference.

Even when gates 1–5 are satisfied, the ARRT adapter throws
`CAPTCHA_REQUIRES_APPROVAL` with `implementedSolver: false`. It contains no
solver, token injection or anti-bot logic. This is intentional: approval must
precede a separately reviewed implementation.

Identifiers such as cookies, anti-forgery token values, CAPTCHA responses and
form payloads are never stored by the monitors.

---

## 10. Configuration defaults

From `config.js`:

| Area | Setting | Default |
| --- | --- | --- |
| Request | `timeoutMs` | 30,000 |
| Request | `maxRequests` | 100 |
| Request | `minIntervalMs` | 5,000 |
| Request | `maxRequestsPerWindow` | `null` |
| Request | `windowMs` | 60,000 |
| Retry | `maxRetries` | 2 |
| Retry | `baseDelayMs` | 2,000 |
| Retry | `factor` | 2 |
| Retry | `maxDelayMs` | 60,000 |
| Retry | `jitterRatio` | 0.2 |
| Circuit | `failureThreshold` | 3 |
| Circuit | `successThreshold` | 2 |
| Circuit | `resetTimeoutMs` | 60,000 |
| Circuit | `halfOpenMaxCalls` | 1 |
| Target | `min` / `max` | 300 / 350 |
| Behavior | `stopOnAccessDenial` | `true` |
| Behavior | `stopOnCaptcha` | `true` |
| Extraction | `maxRows` | 10,000 |
| Extraction | `dedupe` | `true` |

These are **internal safety limits**, not ARRT-published limits or measured ARRT
capacity.

---

## 11. Reuse of the extraction engine

The collection service calls the existing `extractRecords()` from
`backend/src/extraction/extractor.service.js` without modifying its contract:

```text
{ totalRows, acceptedCount, rejectedCount, duplicateCount,
  records, rejectedRows, stats }
```

The ARRT adapter’s `parseResultsHtml()` also calls `extractRecords()`, treating
a saved result fragment as a page source. No second parser was introduced.

Mapping notes:

- the extractor locates the table by headers, not position;
- the ARRT result fragment has not been observed with real search results, so
  header aliases may need extension after authorized sampling;
- records contain `fullName`, `city`, `state`, `credentialString`, optional
  `recordId` and provenance.

---

## 12. Running the offline pipeline

```bash
cd backend
npm test                  # 101 tests (Steps 1, 2, automation)
npm run test:automation   # 37 automation tests
npm run demo:automation   # mock provider demo
```

Observed demo result:

```text
status: completed
stopReason: PLAN_EXHAUSTED
totalRows: 8
acceptedCount: 7
rejectedCount: 0
duplicateCount: 1
requests: 3
```

The demo uses only synthetic fixtures. It does not contact ARRT and does not
require Puppeteer.

---

## 13. Pending integration work

Before any live run:

1. Obtain written authorization and record its reference.
2. Agree on permitted request rate, volume and identification.
3. Agree on a CAPTCHA procedure, or confirm that manual completion is expected.
4. Extend the ARRT adapter with a reviewed live request path and a result
   fragment parser compatible with the observed AJAX response.
5. Install Puppeteer only after approval; keep the no-stealth policy.
6. Validate header aliases against authorized sample output.
7. Define storage, retention and access controls for collected records.
8. Run a small approved pilot before scaling toward 300–350 records.
