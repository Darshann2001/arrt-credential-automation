# ARRT Real Request Flow — Compatibility Audit & Puppeteer Validation

**Date:** 2026-11-17  
**Target:** `https://www.arrt.org/pages/verify-credentials`  
**Scope:** architecture audit, one public-page browser observation, extraction compatibility, CAPTCHA feasibility, request controls and live-readiness verdict  
**Live search submitted:** Yes — exactly one authorized, operator-confirmed sample search (2026-11-17)  
**CAPTCHA solved or token read:** No — completed manually by the operator; never read, injected or stored  
**Records collected:** 11 accepted rows in memory during the sample; 0 stored  

**Status labels used in this report**

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Directly observed from the live public page, saved public client code, or the implementation under audit. |
| **PARTIALLY VERIFIED** | Evidence exists, but one or more server-side or live-result behaviours remain unconfirmed. |
| **UNVERIFIED** | Requires an authorized live search, real result HTML, or controlled load observation. |
| **BLOCKED** | Requires written authorization, an approved CAPTCHA procedure, credentials/accounts, or another external decision. |

---

## 1. Executive summary

### 1.1 Direct answer to the critical question

A valid reCAPTCHA token, supplied correctly, is **necessary but not sufficient**.

The existing architecture is reusable, but the current ARRT adapter cannot execute a real search. Adding only a token provider would still leave these implementation gaps:

1. no live ARRT transport in `fetchPage()`;
2. no capture of the per-session anti-forgery value or ASP.NET cookie context;
3. no capture of the AJAX response body that replaces `#searchList`;
4. no mapping of HTTP 424 to a CAPTCHA-failure/re-token flow;
5. no validation against the real empty-result fragment, row cap or pagination (the success-table shape was validated by one authorized sample);
6. no approved live rate/volume envelope or written ARRT authorization.

The extraction, deduplication, orchestration and monitoring components are contractually compatible with a future live provider. The missing work is a live transport/session integration plus result-contract validation, not a replacement of the existing architecture.

### 1.2 What was newly verified

| Finding | Status | Evidence |
| --- | --- | --- |
| The public page loads successfully in normal Chrome. | **VERIFIED** | HTTP 200; title `Verify Credentials - ARRT`; 63 network responses; 0 failed requests. |
| The search form exposes `#firstname` and `#lastname` with client minimum lengths 1 and 2. | **VERIFIED** | Live DOM and saved HTML. |
| The page uses reCAPTCHA v2 checkbox, not v3. | **VERIFIED** | `.g-recaptcha` with no `data-size`, `api.js`, and a live anchor iframe at `size=normal`. |
| The CAPTCHA site key is public: `6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q`. | **VERIFIED** | Live DOM and saved HTML. |
| Search is an AJAX POST to `/VerifyCredentials/SearchByName`. | **VERIFIED** | Published client widget source and page variables. |
| The request carries `firstName`, `lastName`, `captchaSuccessCode` and a `RequestVerificationToken` header. | **VERIFIED** | Published `VerifyCredentialsWidget.js`. |
| The success callback replaces `#searchList` with the returned HTML. | **VERIFIED** | The authorized sample returned HTTP 200 with `text/html; charset=utf-8` and an HTML fragment containing one result table. |
| HTTP 424 means CAPTCHA failure to the frontend. | **VERIFIED** | Client error branch text. 424 itself was not triggered during the sample. |
| An anti-forgery cookie and hidden field exist. | **VERIFIED** | Cookie named `.AspNetCore.Antiforgery.QZMdixHDH0o`; hidden field present. Values were not read or saved. |
| The site returned no rate-limit headers on the observed page load. | **VERIFIED** | `retry-after` and rate-limit header names absent. |
| Real result headers and columns match the extraction contract. | **VERIFIED** (sample) | 5 header cells; 4 mapped to `fullName`, `city`, `state`, `credentialString`; 1 unmapped action column. |
| All 11 sampled result rows pass validation. | **VERIFIED** (sample) | 11 accepted, 0 rejected, 0 duplicates; acceptance rate 1.0. |
| The real row cap is known. | **UNVERIFIED** | 11 rows returned; cannot distinguish "all matches" from a server-side cap on one query. |
| Server-side pagination exists. | **PARTIALLY VERIFIED** | 0 DataTables wrappers and 0 pagination controls in the captured fragment; a server cap is still unruled out. |
| Live 403/429 behaviour is known. | **UNVERIFIED** | Deliberately not triggered. |
| Written ARRT authorization and CAPTCHA approval exist. | **PARTIALLY VERIFIED** | The operator confirmed authorization interactively for the sample (`authorization.confirmed: true`), but no written reference was recorded (`reference: null`). |

### 1.3 Evidence sources

| Source | Use |
| --- | --- |
| `backend/scripts/inspect-arrt-page.js` | Standalone Puppeteer-core inspection script. |
| `backend/scripts/test-arrt-manual-search.js` | Authorized single-search sample mode. |
| `docs/evidence/arrt-page-observation.json` | Sanitized live observation from one page load (the final run). |
| `docs/evidence/arrt-manual-sample-observation.json` | Sanitized summary of the one authorized sample search. |
| `arrt-verify-page.html` | Saved public page (77,138 bytes). |
| `verify-widget.js` | Saved public search widget source (2,744 bytes). |
| `backend/src/**` | Component-by-component code audit. |
| `backend/src/tests/**` | Offline regression and contract tests. |

The inspection run used installed Chrome 157.0.8103.52 through the new dev-only `puppeteer-core` dependency. The production/runtime browser dependency remains absent and lazy-loaded. Network entries retain origin, path, query-parameter names and safe response headers only; inline `data:` image payloads are reduced to media type and byte length, and cookie, anti-forgery and CAPTCHA values are never written.

### 1.4 Authorized single-sample observation (2026-11-17)

One operator-confirmed sample search was executed through `npm run test:arrt:manual`. The operator typed the name and completed the reCAPTCHA manually; the script submitted once, captured one response and stopped. No token, cookie, session ID or anti-forgery value was read or stored.

| Observation | Result |
| --- | --- |
| Request | `POST /VerifyCredentials/SearchByName`, status **200**, `text/html; charset=utf-8` |
| Latency | 563.53 ms to headers; 1,192.76 ms body read; ~1.76 s total for this sample |
| Response size | 7,564 bytes raw; 3,502 bytes after sanitization; 1 script removed |
| Tables | 1 table, header at row 0, 5 header cells |
| Mapped fields | `fullName`, `city`, `state`, `credentialString` — all required headers matched |
| Unmapped column | 1 (5th column, consistent with a per-row action/detail column) |
| Data rows | 11 candidates, 11 accepted, 0 rejected, 0 duplicates, acceptance rate 1.0 |
| Record identifier | Not present; deduplication used the composite key |
| Detail controls | 11 (one per row) |
| DataTables wrapper / pagination controls | 0 / 0 |
| Empty-result marker | Not present (this query had matches) |
| Failed network requests | 0 |
| Retries / extra searches | 0 / 1 total |

**Cheerio result:** the existing extraction engine parsed the real fragment without any code change — no new header alias was required, no row was rejected and no validation error was raised.

**What this sample does not settle:** the real row cap, server-side paging, the empty-result fragment, HTTP 424 handling, 403/429 behaviour and the token's single-use semantics. Each requires either a different authorized query or a deliberately triggered condition, which this mode must not do as part of a single search.

**Design note on the unmapped column:** the fifth header and its per-row control most likely carry a detail key. The sanitizer deliberately removes `data-*` attributes and detail keys, so `recordId` remains unset and deduplication falls back to the composite key of name, city, state and credential. That is the intended privacy trade-off; a future detail-fetch capability would need its own authorization.

---

## 2. Actual website request flow

### 2.1 Observed page-load flow

```text
GET https://www.arrt.org/pages/verify-credentials
  → HTTP 200, text/html; charset=utf-8
  → title: Verify Credentials - ARRT
  → form #searchForm with #firstname, #lastname, #submitButton
  → reCAPTCHA v2 checkbox .g-recaptcha
  → hidden __RequestVerificationToken outside the form
  → anti-forgery cookie issued to the browser context
  → scripts loaded, including VerifyCredentialsWidget.js
  → #searchList empty; no <table> present
```

Observed timing from the final browser run:

| Metric | Observation |
| --- | --- |
| HTTP status | 200 |
| Navigation duration | 5.8 s including page resources |
| DOMContentLoaded | 3.406 s |
| Load event | 4.132 s |
| Decoded document size | 77,138 bytes |
| Network responses | 63 |
| Failed requests | 0 |

These are single-sample browser timings, not ARRT search latency or a performance benchmark.

### 2.2 Search flow represented by the published client code

The following flow is read from `VerifyCredentialsWidget.js`; it was **not executed**:

```text
user submits #searchForm
  → client checks lastName.trim().length >= 2 and firstName.trim().length >= 1
  → grecaptcha.getResponse()
  → if empty: show "Captcha is required" and abort
  → POST /VerifyCredentials/SearchByName
       header: RequestVerificationToken: <current page anti-forgery value>
       body:   firstName, lastName, captchaSuccessCode
  → success(result):
       #searchList.html(result)
       grecaptcha.reset()
  → error:
       HTTP 424 → "Captcha Failure. Please try again."
       other    → "Failed to load Verify Credential Widget"
```

A second flow exists for record details:

```text
POST /VerifyCredentials/GetDisplayDetails
  header: RequestVerificationToken
  body:   key
  → success: #divDetailsModalContent.html(result)
```

The four requested fields (`fullName`, `city`, `state`, `credentialString`) do not require the details modal, but the modal confirms the anti-forgery header is used consistently.

### 2.3 Request shape and response format

| Item | Finding | Status |
| --- | --- | --- |
| Search endpoint | `/VerifyCredentials/SearchByName` | **VERIFIED** |
| HTTP method | `POST` | **VERIFIED** |
| Anti-forgery header | `RequestVerificationToken` | **VERIFIED** |
| Body field names | `firstName`, `lastName`, `captchaSuccessCode` | **VERIFIED** |
| Content type | Not set explicitly by the widget; jQuery's default form-urlencoded behaviour applies. | **PARTIALLY VERIFIED** |
| Explicit response type | `datatype: 'json'` is misspelled (lowercase `t`), so it is not an effective jQuery `dataType` contract. | **VERIFIED** |
| Success payload | Client inserts `result` as HTML into `#searchList`. | **PARTIALLY VERIFIED** |
| Actual success status/content type/body | Observed in the authorized sample: 200, `text/html; charset=utf-8`, HTML fragment. | **VERIFIED** (sample) |
| Error status 424 | Client treats it as CAPTCHA failure. | **VERIFIED** |
| Other error statuses | Client shows a generic failure message. | **VERIFIED** |
| 403/429 body or headers | Not observed. | **UNVERIFIED** |

**Implication:** the live collector should capture the AJAX response body (or the resulting `#searchList` HTML), not a top-level page navigation. The provider contract can return that fragment as `html`, but the ARRT adapter does not currently do it.

---

## 3. CAPTCHA mechanism and token requirements

### 3.1 Mechanism

| Property | Observation | Status |
| --- | --- | --- |
| Provider | Google reCAPTCHA | **VERIFIED** |
| Widget | v2 checkbox | **VERIFIED** |
| Evidence | `.g-recaptcha`, no `data-size`, `api.js`, anchor iframe `size=normal` | **VERIFIED** |
| Site key | `6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q` | **VERIFIED** |
| Token accessor in client | `grecaptcha.getResponse()` | **VERIFIED** |
| Reset accessor | `grecaptcha.reset()` | **VERIFIED** |
| Token transport name | `captchaSuccessCode` | **VERIFIED** |
| Expected token association | Same ARRT page/session is likely required. | **PARTIALLY VERIFIED** |
| Token single-use/time limit | Not tested. | **UNVERIFIED** |
| Server-side Google validation | Not public. The 424 branch strongly implies it. | **PARTIALLY VERIFIED** |
| Failure status seen in client | 424 | **VERIFIED** |

### 3.2 What a future authorized token provider must do

A reviewed integration would need to:

1. obtain a token for the observed site key and page URL from an approved manual or vendor procedure;
2. place the token in the request as `captchaSuccessCode` — or into the page in the manner approved by the integration review;
3. use the same browser context/page session that holds the anti-forgery cookie and current anti-forgery value;
4. handle rejection by treating HTTP 424 as a CAPTCHA failure and obtaining a fresh token, not by blindly retrying the same token;
5. record only token presence/outcome, never the token value;
6. stop after a bounded number of CAPTCHA failures.

### 3.3 Feasibility against the existing provider interface

The provider interface currently accepts `{ id, mode, requiresBrowser, fetchPage(search, context) }`. It has no token-provider hook.

A future change can inject a token-provider function into the ARRT adapter and keep the existing contract. That is an adapter-level addition, not an architectural rewrite. The current adapter intentionally has no solver and no token injection.

| Question | Answer | Status |
| --- | --- | --- |
| Is a site key exposed? | Yes. | **VERIFIED** |
| Is a specific token parameter expected? | Yes, `captchaSuccessCode`. | **VERIFIED** |
| Must the request share the page session? | Likely yes for anti-forgery; CAPTCHA token binding is not proven. | **PARTIALLY VERIFIED** |
| Does the server also validate cookies/anti-forgery? | The client sends anti-forgery and a cookie exists; server implementation is not public. | **PARTIALLY VERIFIED** |
| Is the token single-use/time-limited? | Not tested. | **UNVERIFIED** |
| Can a provider technically integrate? | Yes, through an injected adapter hook. | **PARTIALLY VERIFIED** |
| Is CAPTCHA the only missing dependency? | No. | **VERIFIED by code audit** |

---

## 4. Session and anti-forgery requirements

### 4.1 Observed session artefacts

The live page issued four cookie names. Only names and attributes were retained; no cookie values were logged or saved.

| Cookie name | Attributes observed |
| --- | --- |
| `nmstat` | `.arrt.org`, `Path=/`, SameSite Lax |
| `.AspNetCore.Antiforgery.QZMdixHDH0o` | `www.arrt.org`, `Path=/`, HttpOnly, SameSite Strict, session cookie |
| `_ga_4WJG44PDZ0` | analytics cookie |
| `_ga` | analytics cookie |

No ARRT login credential was observed or required for the public verification page. The anti-forgery value is a runtime page/session artefact, not a static API key.

### 4.2 Anti-forgery facts

| Finding | Status |
| --- | --- |
| Hidden field `input[name="__RequestVerificationToken"]` is present. | **VERIFIED** |
| The field is outside `#searchForm`; the client reads it by selector. | **VERIFIED** |
| The field had a non-empty value (length 155); the value was not saved. | **VERIFIED** |
| The client sends it in the `RequestVerificationToken` header. | **VERIFIED** |
| An ASP.NET anti-forgery cookie exists. | **VERIFIED** |
| The server validates the hidden value against the cookie/session. | **PARTIALLY VERIFIED** |
| The value expires or rotates. | **UNVERIFIED** |
| A stateless HTTP client can fetch once and reuse the value indefinitely. | **Not supported by evidence; treat as unsafe.** |

### 4.3 Current code support

`session.manager.js` tracks session status, pages opened, request counts and stop reason. It does **not**:

- create or retain a cookie jar;
- read or store an anti-forgery value;
- bind a page to an individual search request;
- expose a request-scoped page/context to the provider.

`page-handler.js` can navigate, fill, click, read HTML and detect CAPTCHA, but it does not capture AJAX response bodies or manage anti-forgery headers.

**Conclusion:** the current session abstraction is a lifecycle bookkeeping layer, not a live ARRT session implementation. It can be extended without replacing the existing modules, but the live flow must run in one browser context.

---

## 5. Request and response compatibility

### 5.1 End-to-end trace in the current code

```text
name-generator
  → search plan / normalizeSearches()
  → collectRecords()
  → request cap + circuit breaker
  → rateLimiter.acquire()
  → provider.fetchPage(search, context)
  → normalizeProviderResult()
  → CAPTCHA / 403 / 429 / HTTP-error checks
  → extractRecords()
  → row validation + normalization
  → duplicateTracker
  → collection report
```

This flow works end to end with the mock provider. With the current ARRT adapter it stops at `fetchPage()` because the adapter deliberately throws before making a request.

### 5.2 Component-by-component compatibility matrix

| Component | Current behaviour | Real ARRT requirement | Gap / risk | Status |
| --- | --- | --- | --- | --- |
| Name generator | Builds Cartesian name combinations and wildcard patterns offline. | Live searches need literal values the site accepts. | ARRT wildcard semantics are unverified; do not send `*` as if it were supported. | **PARTIALLY VERIFIED** |
| Name validation | Rejects empty/invalid local names. | Last name minimum 2, first name minimum 1. | `normalizeSearches()` enforces only non-empty; a one-character last name could pass the local collector. | **PARTIALLY VERIFIED** |
| Collection service | Provider-agnostic orchestration; one HTML page per search. | One AJAX search returns an HTML fragment; possible empty/no-result fragments. | No live transport, no response-body capture, no table-less no-result handling. | **PARTIALLY VERIFIED** |
| Provider contract | Accepts `{ html, status, captcha, headers, ... }`. | Fragment can be supplied as `html`. | No explicit request/session/token context fields; no request-scoped page injection. | **PARTIALLY VERIFIED** |
| ARRT adapter | Encodes observed selectors/endpoints; `fetchPage()` is gated and has no transport. | Must load page, acquire session, obtain token, POST, capture response. | Entire live flow is absent. | **BLOCKED** |
| Page handler | `goto`, `fill`, `click`, `waitForSelector`, HTML read, CAPTCHA detection. | Needs AJAX response capture and request-scoped anti-forgery handling. | No `page.waitForResponse`/response interception; no header construction. | **PARTIALLY VERIFIED** |
| Browser service | Lazy `require('puppeteer')`; no stealth. | A normal approved browser with Chrome executable and a persistent page context. | Runtime default module is still `puppeteer`; only dev-only `puppeteer-core` is installed. | **PARTIALLY VERIFIED** |
| Session manager | Lifecycle, page count, request count, stop reason. | Cookie/anti-forgery context must survive across the GET and search POST. | No cookie jar, no page/session binding, no token lifecycle. | **PARTIALLY VERIFIED** |
| CAPTCHA detection | Detects reCAPTCHA v2/v2 invisible/hCaptcha/Turnstile from HTML. | Detect reCAPTCHA and stop without approval. | Detection is compatible; no solver/token path exists. | **VERIFIED** for detection |
| CAPTCHA acquisition | None; adapter throws with approval. | Approved manual/vendor token acquisition and injection. | External approval; no provider hook. | **BLOCKED** |
| Anti-forgery handling | Constants only; no value read. | Read current value and send header from the same session. | Not implemented. | **BLOCKED** |
| 424 handling | Generic HTTP >= 400 path becomes `PROVIDER_ERROR`; not explicitly classified as CAPTCHA. | 424 must trigger CAPTCHA-failure handling and fresh-token policy. | Current live flow fails closed, but cannot recover correctly. | **PARTIALLY VERIFIED** |
| HTTP 403 | Stops by default; circuit breaker records failure. | Stop and contact site owner; no evasion. | Compatible as a safety behaviour; not observed live. | **VERIFIED** in code / **UNVERIFIED** live |
| HTTP 429 | Retries with `Retry-After`/backoff, then stops. | Honour server rate signals. | Compatible in code; no ARRT 429 observed. | **VERIFIED** in code / **UNVERIFIED** live |
| Request monitor | Status, duration, retries, CAPTCHA, errors; no secrets. | Record operational facts without tokens. | Compatible; live `POST` URL/status still needs to be supplied. | **VERIFIED** |
| Error monitor | Classifies timeout, DNS, TLS, 403, 429, CAPTCHA, provider. | Distinguish 403, 429, 424 and extraction failures. | 424 currently falls into provider failure. | **PARTIALLY VERIFIED** |
| IP monitor | Caller-supplied label; stop recommendation; no rotation. | No IP discovery/rotation. | Compatible. Live blocking behaviour unmeasured. | **VERIFIED** in code / **UNVERIFIED** live |
| Rate limiter / backoff / circuit breaker | 5 s minimum interval, 100 requests, 2 retries, circuit threshold 3. | Values must match written ARRT authorization. | Current values are internal safety defaults, not ARRT limits. | **PARTIALLY VERIFIED** |
| Extraction engine | Header-based table lookup; required header defaults to `fullName`; rows must contain city/state/credential. | Real result fragment must be a parseable table with recognizable headers. | Real headers, columns and no-result fragment are unknown. | **PARTIALLY VERIFIED** contract / **UNVERIFIED** real result |
| Duplicate detection | Uses `recordId` when present, otherwise name+city+state+credential composite. | Real records must expose stable identifiers or all composite fields. | Detail key is not extracted from buttons/links; composite depends on city/state presence. | **PARTIALLY VERIFIED** |
| Pagination | No live pagination; one search = one provider page. | Needs result cap/pagination behaviour. | Request body has no page parameter; client has no observed pagination logic. | **UNVERIFIED** |
| Storage/retention | In-memory collection report only. | Policy for PII, retention and access. | No database/export, no retention policy. | **BLOCKED** by governance |

### 5.3 Key compatibility conclusions

- The collection service and provider contract can accept an ARRT HTML fragment without changing the extraction contract.
- The current live path is not a partial implementation; it is intentionally absent.
- `424` is the most important response-handling mismatch. The client code says it means CAPTCHA failure. The collector currently treats it as a generic provider error and stops. That is safe but not functional for a token-based flow.
- The local name plan can contain wildcard patterns, but the ARRT fields are literal text inputs. Wildcard behaviour must be confirmed or wildcard patterns must be expanded before live submission.

---

## 6. Extraction engine compatibility

### 6.1 What the engine requires

`extractRecords()`:

- loads inline HTML or local fixture content only;
- locates a `<table>` by scanning the first five rows for recognizable headers;
- maps columns by header alias, not by fixed position;
- requires `fullName` by default (`DEFAULT_REQUIRED_HEADERS`);
- passes mapped `city`, `state` and `credentialString` values to validators; missing columns become missing values and rows are rejected;
- accepts optional `recordId` only if a table header maps to it;
- expands `colspan`, ignores repeated header rows and single-cell no-result rows;
- enforces `maxRows` and deduplicates by record ID or composite key.

### 6.2 Observed compatibility against the real public page

A direct offline run of the adapter against the saved public page produced:

```json
{
  "status": "expected-failure",
  "code": "TABLE_NOT_FOUND",
  "message": "No <table> element found in the HTML page."
}
```

This is expected: the public page contains an empty `#searchList`; it has no results table before a search. It proves the engine does not falsely accept the search form as a result page.

### 6.3 What cannot be claimed

No real result fragment was available. Therefore:

- real header labels are unknown;
- whether `city` and `state` are columns in the result table is unknown;
- whether the credential column is labelled `Credential`, `Credentials`, `Credential Number` or another label is unknown;
- whether a detail key is present in a mapped column is unknown;
- whether an empty result returns a one-row “No results” table or a non-table message is unknown;
- whether the table is client-side DataTables, server-rendered HTML or another structure is unknown.

| Extraction question | Finding | Status |
| --- | --- | --- |
| Are current selectors compatible with the public page form? | Yes; form and containers match. | **VERIFIED** |
| Does the public page itself contain a result table? | No. | **VERIFIED** |
| Does the extraction engine parse that page as results? | No; returns `TABLE_NOT_FOUND`. | **VERIFIED** |
| Do real result headers match the aliases? | Yes — 4 required headers mapped; 1 extra action column. | **VERIFIED** (sample) |
| Are names, cities, states and credential strings present? | Yes — 11/11 rows validated in the sample. | **VERIFIED** (sample) |
| Does duplicate detection work with real identifiers? | Detail key extraction not implemented; composite path depends on real fields. | **PARTIALLY VERIFIED** |
| Are missing/malformed real fields handled? | The engine has row-level rejection and diagnostics, but the real schema is unvalidated. | **PARTIALLY VERIFIED** |
| Is pagination handled? | No live pagination implementation. | **UNVERIFIED** |

**No successful real extraction test is claimed.** A synthetic table test would prove only the parser, not ARRT compatibility.

---

## 7. Pagination compatibility

| Observation | Status |
| --- | --- |
| DataTables 1.10.20, responsive, buttons and pagination-input scripts are loaded by the page. | **VERIFIED** |
| No DataTable initialization was found in the page’s inline scripts or `VerifyCredentialsWidget.js`. | **VERIFIED** |
| At initial page load, there are 0 `<table>` elements, 0 `.dataTables_wrapper`, 0 `.dataTables_paginate`, 0 `.dt-button` and 0 `.pagination` elements. | **VERIFIED** |
| The widget has no pagination/page/pageLength logic. | **VERIFIED** |
| The search request contains no page/pageSize parameter. | **VERIFIED** from client source |
| The real result fragment may initialize a table or include its own pagination. | Sample fragment had 0 `.dataTables_wrapper` and 0 pagination controls. | **PARTIALLY VERIFIED** |
| The server may cap results or return all matches. | Sample returned 11 rows; cap indistinguishable from "all matches". | **UNVERIFIED** |

The evidence suggests two possibilities:

1. the result fragment is a complete server-rendered table, and the DataTables libraries are unused or used by a fragment that was not observed; or
2. the result fragment contains a table plus initialization code that the initial page does not show.

The authorized sample returned all 11 rows in a single fragment with no `.dataTables_wrapper` and no pagination controls, which supports the "one HTML page per search" assumption. It does not prove the absence of a server-side row cap: 11 rows could be the complete match set or a cap. The existing collector assumes one page per search and has no pagination crawl, so if a later authorized sample shows paging, that remains additional work.

---

## 8. IP/rate-limit observations

### 8.1 Measured observations

| Signal | Result | Status |
| --- | --- | --- |
| Public page GET, final Chrome run | HTTP 200 | **VERIFIED** |
| Main response content type | `text/html; charset=utf-8` | **VERIFIED** |
| Main response body | 77,138 decoded bytes | **VERIFIED** |
| Rate-limit headers | None observed (`retry-after`, `x-ratelimit-*` absent) | **VERIFIED** for this page load |
| 403 | Not observed | **UNVERIFIED** |
| 429 | Not observed | **UNVERIFIED** |
| CAPTCHA challenge after page load | reCAPTCHA widget present, as expected | **VERIFIED** |
| Search endpoint latency | 563.53 ms to headers, 1,192.76 ms body read (one sample) | **PARTIALLY VERIFIED** |
| Blocking threshold under load | Not measured | **UNVERIFIED** |
| `robots.txt` | Allows `/`, disallows `/Search`; `/VerifyCredentials/SearchByName` is not the disallowed path | **VERIFIED** as a published policy fact, not permission |

`robots.txt` is not authorization. No conclusion about permitted automated search volume can be drawn from it.

### 8.2 Code behaviour

| Condition | Current code behaviour | Status |
| --- | --- | --- |
| `403` | Records access denial, stops by default, circuit failure. | **VERIFIED** in code |
| `429` | Records rate limit, honours `Retry-After`/backoff, retries, then stops. | **VERIFIED** in code |
| `424` | Falls through the generic `status >= 400` branch; treated as `PROVIDER_ERROR`, stops. | **VERIFIED** in code |
| CAPTCHA present in HTML | Records CAPTCHA, stops by default. | **VERIFIED** in code |
| Timeout/connection failure | Retries up to 2, then stops. | **VERIFIED** in code |
| Circuit breaker | Opens after 3 consecutive failures; half-open probe; closes after 2 successes. | **VERIFIED** in code |
| IP rotation/proxy switching | Not implemented. | **VERIFIED** |

The 5,000 ms interval, 100-request cap, 2 retries, circuit threshold 3 and 300–350 target are **internal safety defaults**, not ARRT-published limits or measurements.

---

## 9. Missing implementation

### 9.1 Required before any live search

| # | Missing work | Why it is required | Status |
| --- | --- | --- | --- |
| 1 | **Live ARRT transport.** Implement `fetchPage()` with an approved browser page, load the public page, and issue the search only after the required gates pass. | The adapter currently has no transport and always refuses to run. | **BLOCKED** |
| 2 | **Session/anti-forgery integration.** Keep the page, cookie context and current `__RequestVerificationToken` together; read the value at request time and send the `RequestVerificationToken` header. Never persist the value. | The client flow requires a matching session artefact; server binding is inferred. | **PARTIALLY VERIFIED** |
| 3 | **Approved CAPTCHA path.** Add a token-provider hook or documented manual procedure; handle token failure and expiry with HTTP 424 semantics. | No solver or token provider exists and CAPTCHA automation is not approved. | **BLOCKED** |
| 4 | **Response capture.** Obtain the AJAX response body (or the updated `#searchList` HTML) and pass it to `extractRecords()` as the provider `html`. | Demonstrated by the manual mode; not yet in the production adapter, which still has no transport. | **VERIFIED** in manual mode / **BLOCKED** in production |
| 5 | **424 classification.** Map 424 to a CAPTCHA-failure category and a bounded re-token policy instead of generic `PROVIDER_ERROR`. | Client code proves 424 means CAPTCHA failure; the collector treats it as a generic error. | **PARTIALLY VERIFIED** |
| 6 | **No-result handling.** Distinguish a legitimate empty-result response from a malformed/extraction failure so empty name searches do not stop a 300–350-record run. | The no-results path is implemented and unit-tested offline, but the real empty-result fragment has not been observed. | **UNVERIFIED** |
| 7 | **ARRT search constraints.** Enforce first-name >= 1 and last-name >= 2 before live submission; decide what to do with wildcard patterns. | Minimum lengths are observed; wildcard semantics are not. | **PARTIALLY VERIFIED** |
| 8 | **Result schema validation.** Confirm real headers, credential labels, city/state presence, row cap and any detail key. | Sample confirmed headers and field presence; row cap and detail-key semantics remain open. | **PARTIALLY VERIFIED** |
| 9 | **Pagination/result-cap behaviour.** Implement only if an authorized sample shows server-side paging or a row cap. | Sample had no pagination controls; a server-side cap cannot be ruled out from one 11-row query. | **PARTIALLY VERIFIED** |
| 10 | **Live rate envelope.** Replace internal defaults with the written ARRT-approved interval, concurrency, daily cap and identification requirements. | Current values are internal safety defaults, not ARRT limits. | **BLOCKED** |
| 11 | **Storage/retention/access.** Define where records are stored, for how long, and who can access them. | No storage layer or retention policy exists. | **BLOCKED** |
| 12 | **Approved pilot.** Run a small authorized pilot before scaling to 300–350 accepted records. | Live behaviour, CAPTCHA latency and denial thresholds are unmeasured. | **BLOCKED** |

### 9.2 What is already reusable

- Name generation and wildcard planning.
- HTML loading and Cheerio extraction.
- Header-based column mapping and aliases.
- Record normalization, validation, rejection diagnostics and duplicate detection.
- Collection orchestration, stop reasons, target accounting and monitoring.
- Lazy browser lifecycle, page-handler primitives and session bookkeeping.
- Request/error/IP monitors, pacing, backoff and circuit breaker.

The existing `extractRecords()` contract does not need to change to parse a future ARRT fragment, provided the fragment contains a recognizable table and the required values. Header aliases may need extension after an authorized sample.

---

## 10. Integration plan

### 10.1 Sequence

| Step | Work | Exit criterion | Status dependency |
| --- | --- | --- | --- |
| 0 | Obtain written ARRT authorization and CAPTCHA policy. | Signed/recorded reference, scope, rate and retention terms. | **BLOCKED** |
| 1 | Implement a transport that keeps one approved browser context for GET + search POST. | Session cookie and anti-forgery header proven in a local approved test. | Needs step 0 for live use |
| 2 | Capture the AJAX response body / `#searchList` fragment. | Provider returns the real fragment as `html`; no top-level navigation assumption. | Needs step 1 |
| 3 | Add the approved token-provider or manual procedure. | Token supplied through the approved path; failure/timeout handled. | Needs step 0 + vendor/manual decision |
| 4 | Classify 424 and handle token rejection. | Fresh-token policy and bounded retry; no blind replay. | Needs step 3 |
| 5 | Validate extraction against one authorized result sample. | Confirmed headers, row values, empty result, duplicates. | Needs step 2 + authorization |
| 6 | Confirm pagination/row cap. | Documented result limit and any paging requirement. | Needs step 5 |
| 7 | Replace internal pacing defaults with approved values. | Written rate envelope encoded and tested. | Needs step 0 |
| 8 | Run a small approved pilot. | Request/error/IP monitor report reviewed; no denial event. | Needs steps 1–7 |
| 9 | Scale toward 300–350 accepted records. | Target accounting, duplicate rates and retention controls accepted. | Needs step 8 |

### 10.2 Test plan for the future live adapter

- Unit tests with an injected token provider: success, timeout, empty token, 424, expired token.
- Unit tests with a saved ANTI-FORGERY fixture that assert the header name is used and the value is never logged.
- Provider contract test: search returns a fragment, a no-result fragment and a malformed fragment.
- Extraction tests using authorized real samples, including missing city/state and unusual credential labels.
- Session test: cookie context and page are reused between GET and POST.
- Pacing/retry test: 429 with `Retry-After`, timeout, circuit open.
- Redaction test: no cookie, anti-forgery, CAPTCHA token or form payload appears in monitor output.
- Pilot review: request counts, status codes, CAPTCHA failures, duplicate rate and target shortfall.

### 10.3 Effort estimate

Assuming written authorization and a CAPTCHA procedure are available:

| Work package | Estimate |
| --- | --- |
| Live transport + session/anti-forgery + response capture + 424 handling | 2–3 engineering days |
| Token-provider/manual CAPTCHA integration and failure tests | 1–2 engineering days |
| Real-schema extraction, no-result handling, constraints and pagination decision | 1–2 engineering days |
| Pilot harness, redaction checks, pacing validation and reporting | 2–3 engineering days |
| Storage/retention/access implementation, if required in this codebase | 1–2 engineering days |

**Indicative total:** 7–12 engineering days after approvals, excluding external waiting for ARRT, CAPTCHA vendor access or a real result sample. If the result fragment is materially different from the current assumptions, add 2–4 days.

---

## 11. Risks and external dependencies

### 11.1 Risk register

| Risk | Impact | Current mitigation | Status |
| --- | --- | --- | --- |
| No written ARRT authorization | No live work is permissible. | Adapter and collector gates refuse live work. | **BLOCKED** |
| CAPTCHA automation is not approved | Token integration cannot proceed. | No solver; CAPTCHA detection stops the run. | **BLOCKED** |
| Token is bound to the exact browser/page/session | A provider token may be rejected even if otherwise valid. | Not tested; must be proven in an approved pilot. | **UNVERIFIED** |
| Anti-forgery value/cookie mismatch | Search returns an error or 400/424-like failure. | No live flow; must keep one browser context. | **PARTIALLY VERIFIED** |
| 424 is treated as generic provider failure | No token refresh; run stops. | Fails closed today. | **VERIFIED** code gap |
| Real result table is absent or differently labelled | Extraction rejects every row or fails the run. | Header aliases and row diagnostics exist; one sample matched exactly. | **PARTIALLY VERIFIED** |
| Empty result returns a non-table fragment | Collector treats a legitimate empty search as extraction failure. | No-results detection exists and is tested offline; live fragment unseen. | **UNVERIFIED** |
| Pagination or result cap unknown | Cannot plan 300-350 accepted records or may miss rows. | Sample showed no pagination controls; cap still unruled out. | **PARTIALLY VERIFIED** |
| Rate limits unknown | A live run could be blocked. | 5 s interval, 100-request cap, stop on denial. | **UNVERIFIED** live |
| CAPTCHA vendor latency/failure rate unknown | Throughput and cost cannot be forecast. | No credits purchased; no tasks submitted. | **UNVERIFIED** |
| PII retention/access undefined | Collected records could be mishandled. | Four-field record contract; no storage layer. | **BLOCKED** by policy |
| Automated access may violate terms even if technically possible | Reputational/legal exposure. | Authorization is a prerequisite, not an afterthought. | **BLOCKED** |

### 11.2 External dependencies and owners

| Dependency | Needed for | Owner |
| --- | --- | --- |
| Written ARRT authorization with reference and scope | Any live request | Requester / ARRT |
| Permitted rate, concurrency and daily volume | Pacing and pilot design | ARRT |
| CAPTCHA policy (manual or approved service) | Token acquisition | ARRT + requester |
| CAPTCHA vendor account/API key/credits, if approved | Automated token path | Requester |
| Authorized result sample or small pilot access | Headers, rows, empty results, pagination | ARRT + requester |
| Retention/access/privacy sign-off | Storing collected records | Organization |
| Approved browser/runtime and dependency pinning | Live browser execution | Engineering + security |
| Secret storage for any vendor API key | Token-provider operation | Engineering + security |

No ARRT login password is required by the observed public flow. The runtime anti-forgery value is issued by the page/session; it is not a static credential to request from ARRT.

---

## Final technical verdict (Phase 7)

### Q1. Can the current architecture support real ARRT automation?

**Yes, at the architecture level, but not as currently implemented.** The provider abstraction, extraction engine, deduplication, collection orchestration and monitoring are compatible with a future live adapter. The ARRT adapter itself has no live transport and cannot currently perform a search. Status: **PARTIALLY VERIFIED**.

### Q2. Is reCAPTCHA v2 the primary remaining blocker?

**It is a primary hard gate, but not the only blocker.** CAPTCHA is the first missing runtime dependency and requires explicit approval. Even with a valid token, the live flow still needs anti-forgery/session handling, AJAX fragment capture, 424 handling, real result-schema validation and pagination/rate decisions. Status: **BLOCKED** for authorization/approval; **PARTIALLY VERIFIED** for technical scope.

### Q3. If an authorized valid token is supplied, what exact additional dependencies remain?

1. A live transport in `fetchPage()`.
2. A browser context that retains the anti-forgery cookie.
3. Reading the current `__RequestVerificationToken` and sending the `RequestVerificationToken` header.
4. A POST body containing `firstName`, `lastName`, `captchaSuccessCode`.
5. Capture of the AJAX response body or updated `#searchList` HTML.
6. Mapping HTTP 424 to CAPTCHA failure and fresh-token handling.
7. Real result-table validation and no-result handling.
8. Pagination/result-cap confirmation.
9. Written rate/volume guidance and a small approved pilot.
10. Storage/retention controls if records are retained.

### Q4. Does the current request/session architecture support the required flow?

**Partially.** It has lifecycle bookkeeping and a page handler, but it does not have a cookie jar, anti-forgery-value handling, request-scoped page context or AJAX response capture. The existing modules can be extended without replacing the architecture. Status: **PARTIALLY VERIFIED**.

### Q5. Can the existing Cheerio engine parse actual ARRT results?

**Yes, for the one observed sample.** The engine parsed the real result fragment with no code change: 11 rows, 11 accepted, 0 rejected, 0 duplicates, all four required headers mapped. The public page itself returns `TABLE_NOT_FOUND`, which is expected because it contains no result table. Empty results, row caps and pagination remain unproven. Status: **VERIFIED** for the sampled success fragment; **UNVERIFIED** for empty/paged variants.

### Q6. What must be implemented before a live collection of 300–350 records?

All items in section 9.1, at minimum: live transport, same-session anti-forgery, approved CAPTCHA path, 424 handling, AJAX fragment capture, no-result handling, real header/schema validation, pagination/result-cap decision, approved rate envelope, retention policy and an approved pilot.

### Q7. What approvals and credentials must the organization provide?

- Written ARRT authorization and reference.
- Approved scope, endpoints, rate, concurrency, daily volume and identification.
- CAPTCHA policy approval, and if a vendor is used, the vendor account/API key/credits.
- A real result sample or permission for a small pilot.
- Retention, access and privacy sign-off.
- Approved production browser/runtime and secret storage.

The public page does not require an ARRT login password. The anti-forgery value and cookies are runtime session artefacts and must not be treated as reusable credentials.

### Q8. What is the estimated remaining engineering effort?

**7–12 engineering days after approvals**, rising to roughly **9–16 engineering days** if the result structure and pagination differ materially from current assumptions (the section 10.3 estimate plus 2–4 days). This excludes waiting for ARRT authorization, CAPTCHA vendor access, credits, and a real result sample.

### Final verdict

**Verdict: READY AFTER CAPTCHA + OTHER CHANGES**

This is not **READY AFTER CAPTCHA INTEGRATION** because a token alone does not satisfy the anti-forgery/session flow, does not capture the AJAX result fragment, does not handle 424 correctly, and does not validate the real result schema.

It is not **NOT READY — ADDITIONAL BLOCKERS** in the architectural sense: the existing modules are reusable and the remaining work is well-scoped. It is, however, **not ready to execute live today**. Written ARRT authorization, an approved CAPTCHA procedure, a real result sample and a small approved pilot remain external prerequisites.

---

## Verification and test results

| Check | Result |
| --- | --- |
| Full test suite | 112 total, 112 passed, 0 failed |
| Test duration | ~380 ms for the manual-mode suite; ~630 ms full suite |
| Coverage available | Yes, Node experimental test coverage |
| Line coverage | 92.46% |
| Branch coverage | 83.22% |
| Function coverage | 95.84% |
| `node --check` on inspection and manual scripts | Passed |
| Live inspection | 3 public page loads total in this phase (1 aborted by a script bug after navigation, 2 completed); each completed load returned HTTP 200 with 0 failed requests |
| Live search requests | 1 — one authorized, operator-confirmed sample search |
| CAPTCHA tokens solved/read | 0 by software; 1 completed manually by the operator and never read |
| Records collected | 11 extracted in memory during the sample; 0 stored or exported |

Coverage note: the inspection and manual-sample scripts are operational/dev tools and are not included in the unit-test coverage total. The automation and extraction modules retain their prior coverage profile.

### New files

- `backend/scripts/inspect-arrt-page.js`
- `backend/scripts/test-arrt-manual-search.js`
- `backend/src/tests/manual-search.test.js`
- `backend/fixtures/arrt-manual/README.md`
- `docs/evidence/arrt-page-observation.json`
- `docs/evidence/arrt-manual-sample-observation.json`
- `docs/manual-sample-search-mode.md`
- `docs/arrt-real-flow-compatibility.md`

### Existing files modified

- `backend/package.json` — added dev-only `puppeteer-core`, `inspect:arrt`, `test:arrt:manual` and `test:manual-search` scripts; registered the manual-mode test file in `test`.
- `backend/package-lock.json` — lockfile update for `puppeteer-core`.

No production module, extraction contract, collection behaviour, live gate or CAPTCHA policy was changed.

---

## Director-ready summary

The public ARRT page is technically understood and the existing pipeline is structurally reusable. We verified the page, form, reCAPTCHA v2 checkbox, site key, AJAX endpoint, request field names, anti-forgery header and cookie context, 424 frontend behaviour, and the absence of observed rate-limit headers. We also confirmed that the current page has no result table and that the extractor correctly refuses it with `TABLE_NOT_FOUND`.

One authorized, operator-confirmed sample search then returned a real result fragment: HTTP 200, `text/html; charset=utf-8`, one table with five headers (four recognised, one action column) and 11 rows. The existing Cheerio engine accepted all 11 rows with no code change and reported zero rejections and zero duplicates.

A valid reCAPTCHA token alone will **not** make the current automation work. The remaining work is the live transport and same-session anti-forgery/AJAX-fragment integration, 424 classification, empty-result and row-cap confirmation, and an approved rate envelope. The architecture does not need replacement.

**Final position:** `READY AFTER CAPTCHA + OTHER CHANGES`. No live collection should start until ARRT provides written authorization, an approved CAPTCHA procedure, permitted rate/volume guidance, and either a real result sample or a small approved pilot. No search was submitted, no CAPTCHA was solved, no token or cookie value was persisted, and no IP evasion or proxy rotation was used.
