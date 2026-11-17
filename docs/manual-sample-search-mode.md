# Authorized Manual-CAPTCHA Sample-Search Mode

**Status:** implemented; one authorized live sample search executed successfully (2026-11-17)  
**Date:** 2026-11-17  
**Command:** `npm run test:arrt:manual` (from `backend/`)  
**Scope:** one operator-approved sample search, one response, one extraction run

---

## 1. Purpose and separation

This mode validates the real ARRT browser session, the search request, the AJAX
response and the existing Cheerio extraction engine without enabling unattended
or bulk collection.

It is deliberately separate from `src/automation/collection.service.js`:

- no production provider is changed;
- no live collection is enabled;
- no retry, loop, pagination or bulk path exists;
- the only output is a sanitized JSON summary and, optionally, one sanitized
  HTML fixture.

## 2. Preconditions

Before using this command:

1. written ARRT authorization must cover the sample search;
2. the organization's data-handling rules must state whether result HTML and
   extracted records may be stored;
3. the operator must be present to enter the sample name and complete the
   reCAPTCHA manually.

The command requires an interactive terminal. It refuses pipes and unattended
execution before opening Chrome.

## 3. Command and options

```bash
cd backend
npm run test:arrt:manual
```

Optional flags:

| Flag | Purpose |
| --- | --- |
| `--authorization-reference <text>` | Optional internal authorization reference. |
| `--timeout <ms>` | Page/navigation timeout, default 45000. |
| `--response-timeout <ms>` | Search-response timeout, default 60000. |
| `--executable <path>` | Chrome/Edge executable path. |
| `--save-fixture` | Offer to save sanitized response HTML. |
| `--fixture-authorized` | Confirm data-handling rules permit saving. |
| `--fixture-name <name>` | Simple file name inside `backend/fixtures/arrt-manual/`. |
| `--help`, `-h` | Show help. |

Fixture saving requires both `--save-fixture` and `--fixture-authorized`, plus a
final typed `SAVE FIXTURE` confirmation. The default is no saving.

## 4. Operator flow

1. Type exactly `I AM AUTHORIZED`; nothing opens before this phrase matches.
2. Chrome opens visibly on the ARRT verification page.
3. The script waits for the search form and reCAPTCHA widget.
4. The operator enters the sample first and last name manually.
5. The operator completes the reCAPTCHA manually.
6. The operator presses Enter in the terminal without clicking Search.
7. The script verifies only the field lengths and button state; it does not read
   the name values or the CAPTCHA response.
8. The operator types exactly `SUBMIT ONE SEARCH`.
9. The script clicks Search once and waits for the POST response to
   `/VerifyCredentials/SearchByName`.
10. The script reports the response facts, structure comparison and extraction
    result, then closes Chrome and exits.

If a search request was already observed before the script's own click, the
script aborts without sending a second request.

## 5. What is captured

- HTTP status.
- Content type.
- Response duration to headers and body-read duration.
- Response and sanitized byte counts.
- SHA-256 of the sanitized response.
- Table count, recognized mapped fields, missing required fields, candidate row
  count, no-results marker, DataTables/pagination markers, script count, detail
  controls and form controls.
- Extraction fields, accepted/rejected/duplicate/total counts, ignored rows,
  validation-error codes and duplicate strategies.
- Compatibility notes comparing the observed structure with the existing
  header-based extraction contract.

Record values are never printed. Validation errors are reported as codes only.

## 6. Safety controls

- `headless: false` is hardcoded; there is no headless option.
- CAPTCHA solving, token reading, token injection and token storage are absent.
- Cookie, session-id and anti-forgery values are never read or written by the
  script; they remain inside the browser context.
- No proxy, IP rotation, user-agent override or stealth setting is applied.
- Exactly one submission is allowed; there is no retry or pagination path.
- Sanitization removes scripts, styles, frames, form controls, comments, event
  handlers, `data-*` attributes and token-like attributes.
- Fixture output is restricted to `backend/fixtures/arrt-manual/`.

## 7. Handling outcomes

| Condition | Outcome | Exit code |
| --- | --- | --- |
| Valid response, records extracted | `captured_and_extracted` | 0 |
| Confirmed empty result | `empty_result` | 0 |
| HTTP 424 or CAPTCHA-failure body | `captcha_failure` | 2 |
| HTTP 403 | `access_denied` | 3 |
| HTTP 429 | `rate_limited` | 3 |
| Unexpected content type or empty body | `unexpected_content_type` / `empty_body` | 4 |
| Other HTTP error | `http_error` / `server_error` | 4 |
| No table or mismatched headers | `unexpected_structure` | 1 |
| Extraction failure | `extraction_error` | 1 |
| Rows present but none accepted | `no_accepted_records` | 1 |
| Operator abort or no authorization phrase | `aborted` | 5 |

No outcome triggers an automatic retry.

## 8. Offline verification performed

- `node --check` passed for the new script and tests.
- The command refuses a piped or non-interactive terminal before opening Chrome.
- `--help` works without launching a browser.
- Unit tests cover sanitization, structure analysis, response classification,
  extraction summary, error redaction, phrase matching and fixture-path
  containment.
- Full suite: 112 tests, 112 passed, 0 failed.

## 9. Live status

One authorized, operator-confirmed sample search was executed successfully. The
operator typed the sample name and completed the reCAPTCHA manually; the script
submitted once, captured one response and stopped. The raw summary is recorded
in `docs/evidence/arrt-manual-sample-observation.json`.

### 9.1 Observed request and response

| Observation | Result |
| --- | --- |
| Endpoint | `POST /VerifyCredentials/SearchByName` |
| Status | 200 |
| Content type | `text/html; charset=utf-8` |
| Time to headers | 563.53 ms |
| Body read | 1,192.76 ms |
| Response size | 7,564 bytes |
| Sanitized size | 3,502 bytes (1 script removed) |
| Failed network requests | 0 |

### 9.2 Observed structure

- 1 table, header at row 0, **5** header cells.
- 4 columns mapped: `fullName`, `city`, `state`, `credentialString`.
- 1 unmapped column, consistent with a per-row action/detail column.
- 11 data-row candidates.
- 11 detail controls (one per row).
- 0 `.dataTables_wrapper`, 0 pagination controls, no no-results marker.
- No record identifier exposed by a mapped header.

### 9.3 Extraction result

The existing Cheerio engine parsed the real fragment **without any code change**:

| Metric | Value |
| --- | --- |
| Accepted | 11 |
| Rejected | 0 |
| Duplicates | 0 |
| Total rows | 11 |
| Validation errors | none |
| Acceptance rate | 1.0 |
| Fields | `fullName`, `city`, `state`, `credentialString` |

### 9.4 What remains unverified

- Real row cap: 11 rows could be all matches or a capped set.
- Server-side pagination: none observed in this fragment, but a server cap is
  still possible.
- The empty-result fragment.
- HTTP 424 (CAPTCHA failure) handling end to end.
- 403/429 behaviour.
- CAPTCHA token single-use/time-limit semantics.
- Written authorization reference: the run recorded `authorization.confirmed:
  true` but no reference value.

No fixture was saved during this run. A further sample should only be run under
the same authorization and confirmation rules, and should not attempt to force
an empty result, a 424 or a rate limit.
