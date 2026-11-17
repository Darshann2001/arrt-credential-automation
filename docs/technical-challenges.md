# Technical Challenges — ARRT Automation Preparation

**Status:** offline scaffolding complete; live collection blocked  
**Date:** 2026-11-17  
**Companion documents:** `captcha-investigation.md`,
`ip-blocking-investigation.md`, `automation-architecture.md`

This document separates **observed problems**, **inferred risks** and **items
not attempted**. No incident, failure rate or performance figure is claimed
without evidence.

---

## 1. Challenge map

| # | Challenge | Evidence level | Current state |
| --- | --- | --- | --- |
| 1 | reCAPTCHA v2 gates every search | observed | detection + stop implemented |
| 2 | Anti-forgery token and session coupling | observed client side; inferred server side | offline analysis only |
| 3 | Search returns an HTML fragment via AJAX | observed | extractor can parse fragments; live path not built |
| 4 | Real result headers and pagination unknown | not observed | header aliases may need extension |
| 5 | Rate limits and blocking behavior unknown | not observed | conservative pacing + stop rules |
| 6 | 2Captcha cost/latency/failure rate unmeasured | not attempted | no credits purchased |
| 7 | Authorization scope unresolved | absent | live adapter gated |
| 8 | Puppeteer not installed | observed | lazy load returns `BROWSER_UNAVAILABLE` |
| 9 | Target counted in accepted records, not requests | design constraint | overshoot possible per page |
| 10 | PII minimization and retention | design constraint | four fields only; no storage layer |
| 11 | Single-sample network measurement | observed limitation | documented, not generalized |
| 12 | Synthetic tests can diverge from production | design constraint | live pilot required |

---

## 2. Challenge details

### 2.1 CAPTCHA blocks every search

**Observed evidence**

- The page loads `https://www.google.com/recaptcha/api.js`.
- The form contains `.g-recaptcha` with site key
  `6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q` and no `data-size="invisible"`.
- `verify-widget.js` calls `grecaptcha.getResponse()` and aborts when empty.
- The response is posted as `captchaSuccessCode`.
- The AJAX error handler treats HTTP **424** as `Captcha Failure`.

**Root cause**

The search endpoint is protected by a Google reCAPTCHA v2 checkbox and a
server-side validation step. A search cannot be issued from a plain HTTP client
without a valid token.

**Impact**

- No live search is possible in this phase.
- Any live implementation needs either a human completing the checkbox or an
  approved automated procedure.
- A failed token produces 424, which is not the same as 403 or 429.

**Current mitigation**

- `detectCaptchaInHtml()` identifies reCAPTCHA v2 checkbox, v2 invisible,
  hCaptcha and Turnstile.
- `collectRecords()` stops with `CAPTCHA_DETECTED` by default.
- Even with `stopOnCaptcha: false`, the search is skipped, not solved.
- The ARRT adapter refuses live fetch with or without a CAPTCHA approval
  reference; it has no solver.

**Dependency**

Written confirmation that automated or third-party CAPTCHA solving is allowed,
or an agreed manual procedure.

---

### 2.2 Anti-forgery token and session coupling

**Observed evidence**

- The page contains `input[name="__RequestVerificationToken"]`.
- Both AJAX calls send a `RequestVerificationToken` header.
- The search call sends `firstName`, `lastName` and `captchaSuccessCode`.
- The page also loads ASP.NET-style infrastructure and session cookies.

**Root cause**

ASP.NET anti-forgery validation ties a request to a token issued to the same
session. A token captured from one response is not a durable API key.

**Impact**

A live client must:

1. load the page;
2. retain the session cookie(s);
3. read the current anti-forgery value;
4. send it in the correct header;
5. do so before the session/token expires.

This makes a stateless `fetch()` implementation fragile.

**Current mitigation**

- `session.manager.js` exists to own a session and page lifecycle.
- The adapter records the selector and header name as observed constants.
- Tokens are never written to disk or to monitor events.
- No token replay or extraction is implemented.

**Dependency**

A reviewed live flow that reads the token at request time from the same
session. This cannot be validated until a search is authorized.

---

### 2.3 Search results are an AJAX HTML fragment

**Observed evidence**

`makeGrid()` posts to `/VerifyCredentials/SearchByName` and on success does:

```js
placeholder.html(result);
```

The result is inserted into `#searchList`; the page itself does not navigate to
a result URL.

**Root cause**

The result table is a server-rendered HTML fragment returned by AJAX, not a
standalone document.

**Impact**

- A normal page navigation would not expose the results table.
- The collector must capture the AJAX response body or the updated container
  HTML.
- `parseResultsHtml()` can feed such a fragment to the existing extractor, but
  the live transport is not built.

**Current mitigation**

- `arrt.adapter.js` exposes offline `parseResultsHtml()` using the unchanged
  Step 2 engine.
- The mock provider returns fixture HTML through the same provider contract.
- Live capture remains gated.

**Dependency**

A reviewed live transport (Puppeteer response interception or an approved
server-side equivalent), plus authorized sample responses.

---

### 2.4 Real result schema and pagination are unknown

**Observed evidence**

- No search was submitted, so no real result table was seen.
- The public page shows a search form and an empty `#searchList`.
- The client script shows no pagination logic.

**Root cause**

The result contract is only visible after a successful CAPTCHA-gated search.

**Impact**

- Header labels and aliases for the real table are unconfirmed.
- Whether results are capped, paginated or sorted is unknown.
- The 300–350 target may require many narrow searches or may be limited by the
  site’s result cap.
- Duplicate behavior across overlapping name searches is unmeasured.

**Current mitigation**

- The extractor maps by header labels and supports aliases.
- Cross-page duplicate tracking is already implemented.
- Fixtures cover normal, reordered, missing, duplicate, malformed and empty
  tables.
- No pagination crawler is enabled.

**Dependency**

Authorized sample result HTML (or a small approved pilot) to confirm headers,
row limits and pagination.

---

### 2.5 Rate limits and blocking behavior are unmeasured

**Observed evidence**

- Two public page GETs succeeded.
- The instrumented GET returned HTTP 200 with no rate-limit headers.
- No 403, 429 or `Retry-After` was observed.
- `robots.txt` disallows `/Search` but not `/VerifyCredentials/SearchByName`.

**Root cause**

The site’s throttling policy is not published in the observed materials, and
provoking it would be inappropriate without authorization.

**Impact**

- Safe request rates are unknown.
- A successful page load does not prove that repeated searches are acceptable.
- Any rate figure in this repository is a safety default, not an ARRT limit.

**Current mitigation**

- 5 s minimum interval, 100-request cap, 2 retries, circuit breaker.
- Stop on first 403 or CAPTCHA.
- `Retry-After` is honored as authoritative.
- No proxy rotation or IP switching.

**Dependency**

Written rate/volume guidance from ARRT.

---

### 2.6 2Captcha latency and reliability cannot be measured

**Observed evidence**

- 2Captcha documents reCAPTCHA v2 support via `createTask` /
  `getTaskResult`.
- Public pricing shows **$1 – $2.99 per 1,000**.
- The displayed solving speed is **“0s”**, which is a marketing display, not a
  measurement.

**Root cause**

Measuring real solve time and failure rate requires an account, credits and a
submitted task.

**Impact**

- No throughput estimate can be made.
- No cost estimate beyond the vendor’s public range is possible.
- The 424 rejection path and retry cost are unquantified.

**Current mitigation**

- No credits purchased.
- No task submitted.
- No solver integrated.
- Reports explicitly label latency as unmeasured.

**Dependency**

Authorization plus a decision to use the vendor, then a measured pilot.

---

### 2.7 Authorization is the primary blocker

**Observed evidence**

No written permission from ARRT is present in the repository. The project brief
requires authorization before live collection.

**Root cause**

The data-collection scope, permitted rate, CAPTCHA policy and retention rules
are contractual/legal questions, not code questions.

**Impact**

- Live requests must remain disabled.
- Even a technically working solver would not make collection permissible.
- Reports and code must not imply approval exists.

**Current mitigation**

- `allowLiveProvider` defaults to false.
- `authorization.confirmed === true` and a non-empty reference are required.
- The ARRT adapter separately requires CAPTCHA approval.
- The adapter still refuses to run after approval because no solver exists.

**Dependency**

Written authorization with a reference, scope and rate guidance.

---

### 2.8 Puppeteer is absent by design

**Observed evidence**

`backend/node_modules` contains Cheerio but not Puppeteer. The browser service
lazy-loads the module.

**Root cause**

Installing a browser is unnecessary for offline extraction and would add a large
dependency before the live design is approved.

**Impact**

- `createBrowserService().launch()` returns `BROWSER_UNAVAILABLE`.
- The offline demo and all tests run without a browser.
- A future live run must install and pin an approved version.

**Current mitigation**

- Lazy `require()` with a descriptive error and remediation hint.
- Dependency injection supports a fake Puppeteer module in tests.
- No stealth or evasion launch flags are applied.

**Dependency**

Approval to install Puppeteer and agreement on its version and launch options.

---

### 2.9 Target accounting and per-page overshoot

**Observed evidence**

The extraction engine returns multiple records per page; the collector checks
the target between searches.

**Root cause**

The target is measured in accepted records, while work is performed in search
pages. A page cannot be stopped mid-extraction without risking inconsistent
counts.

**Impact**

A run targeting 350 accepted records can finish a page above 350. The same page
can also contain duplicates and rejected rows, so request count and record count
are not interchangeable.

**Current mitigation**

- `target.min` / `target.max` are explicit and reported.
- `stats.target.shortfall` is computed.
- Counts remain `accepted + rejected + duplicate = totalRows`.
- Overshoot is documented rather than hidden.

**Dependency**

None for correctness; the final report should state the actual accepted count,
not just “300–350”.

---

### 2.10 PII minimization and retention

**Observed evidence**

The requested output is limited to name, city, state and credential string.

**Root cause**

The source is a public credential-verification directory, but the collected
rows are still personal data.

**Impact**

- Storing more than necessary increases legal and ethical exposure.
- Logs must not capture cookies, tokens, CAPTCHA responses or full HTML with
  unrelated personal data.
- Retention and access controls are undefined.

**Current mitigation**

- The record contract contains only the four requested fields plus provenance.
- Monitors exclude tokens, cookies, CAPTCHA responses and form values.
- No database or file export is implemented.
- No PDF retrieval is implemented.

**Dependency**

A written retention/access policy before collection is stored.

---

### 2.11 Single-sample network measurement

**Observed evidence**

One instrumented GET produced DNS 0.179 s, connect 0.352 s, TLS 1.079 s,
TTFB 1.380 s, total 2.293 s.

**Root cause**

Only one measurement was taken; network conditions, CDN behavior and server
load vary.

**Impact**

These numbers cannot be used to estimate 300–350 record collection time or to
set a timeout with confidence.

**Current mitigation**

- The measurement is labeled as a single sample.
- Default timeout is 30 s, deliberately conservative.
- Duration percentiles are computed per run by the request monitor.

**Dependency**

A small authorized pilot to establish realistic latency.

---

### 2.12 Synthetic tests can diverge from production

**Observed evidence**

The automation suite uses `mock.provider.js` and synthetic fixtures. It proves
control flow, not ARRT behavior.

**Root cause**

Live behavior cannot be exercised without authorization and a CAPTCHA solution.

**Impact**

- A green test suite does not prove the live adapter works.
- Header aliases, fragment shape, 424 handling and session coupling remain
  unvalidated against the real endpoint.

**Current mitigation**

- Reports distinguish “verified in tests” from “observed from ARRT”.
- The live adapter is inert rather than half-working.
- The mock provider is deterministic, so failures are reproducible.

**Dependency**

An authorized pilot and real samples.

---

## 3. Failed, skipped and not-attempted items

### 3.1 Not attempted

- Submitting a search to `/VerifyCredentials/SearchByName`.
- Solving or bypassing the CAPTCHA.
- Injecting a token into the page.
- Purchasing 2Captcha credits or submitting a task.
- Measuring CAPTCHA solve latency or failure rate.
- Provoking HTTP 403 or 429.
- Testing proxy rotation or IP switching.
- Discovering the host’s public IP.
- Crawling pagination.
- Fetching PDFs or detail modals.
- Installing Puppeteer.
- Storing records in a database.

### 3.2 Attempted and resolved during implementation

| Issue | Resolution |
| --- | --- |
| `mock.provider.js` used a wrong relative path to the extraction loader | Corrected to `../../extraction/html-loader` and the fixture directory to two levels up |
| `totalRows` and related counters were captured by value in `collectRecords` | Replaced with a mutable `totals` object |
| `stopOnCaptcha: false` still stopped the run | Changed to skip the search and continue |
| Live-provider gate failure was reported as a generic provider error | Added `AUTHORIZATION_REQUIRED` stop reason and classification |
| `rate-limiter.js` called `readPositiveInteger` with the wrong argument order | Corrected signature and call sites |
| IP monitor default threshold comment said 2 while code used 1 | Comment corrected to match code |

These were implementation defects found during test runs, not ARRT incidents.

---

## 4. Dependency summary

| Dependency | Blocks | Owner |
| --- | --- | --- |
| Written ARRT authorization and reference | any live request | requester |
| Permitted rate/volume guidance | pacing and pilot size | ARRT |
| CAPTCHA policy (manual vs service) | token acquisition | ARRT + requester |
| 2Captcha account/credits | any vendor measurement | requester |
| Real result sample or approved pilot | header aliases, pagination | ARRT + requester |
| Puppeteer installation approval | browser execution | requester |
| Retention/access policy | storage/export | requester |

---

## 5. Conclusion

The offline pipeline is complete and tested: **101/101 tests pass**, the mock
demo runs end to end, and the extraction engine is reused without modification.

The unresolved challenges are not code defects. They are:

1. authorization and CAPTCHA scope;
2. unknown live result shape and pagination;
3. unknown rate limits;
4. unmeasured vendor latency and reliability;
5. no approved browser/runtime installation.

Live collection should not start until items 1–5 are resolved in writing.
