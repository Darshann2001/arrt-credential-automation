# ARRT Name Search, Extraction, Automation and API (Steps 1–4)

This repository contains four components:

1. **Step 1 — search-plan generation:** validated first-name / last-name
   combinations and alphabetical wildcard patterns.
2. **Step 2 — fixture-driven HTML extraction:** header-mapped extraction of
   `fullName`, `city`, `state` and `credentialString` from local or synthetic
   HTML result tables.
3. **Step 3 — automation scaffolding:** provider contract, offline mock
   provider, pacing/backoff/circuit breaker, monitoring, and an inert ARRT
   adapter that reuses the Step 2 extraction engine.
4. **Step 4 — persistence and API:** PostgreSQL via Prisma, plus an Express API
   that serves stored records, import jobs and dashboard statistics.

Nothing here performs a live ARRT search, drives a browser, solves or bypasses
CAPTCHAs, fetches remote pages, or rotates proxies/IPs. Step 4 stores and serves
already-extracted records over HTTP, but `POST /api/jobs` only creates a
`PENDING` row and never triggers collection. The live ARRT path remains blocked
by explicit authorization and CAPTCHA-approval gates. The admin frontend for
Steps 1–4 is a separate Next.js app in [`../frontend`](../frontend/README.md).

## Requirements

- Node.js **18.18+** (tested on Node 22.20.0; Prisma 6 requires 18.18+)
- `npm install` installs all runtime dependencies (Cheerio, Express, Prisma client)
- PostgreSQL 14+ for the API, or Docker for the bundled Compose service

Cheerio is pinned to `1.0.0`. Puppeteer is **not** installed; the browser service
loads it lazily and reports `BROWSER_UNAVAILABLE` when it is absent.

## Run

```bash
cd backend
npm install
npm test                  # all Step 1–4 tests (no PostgreSQL needed)
npm run test:automation   # Step 3 automation tests only
npm run test:api          # Step 4 API tests only
npm start                 # Step 1 demo: combinations + A*-Z* patterns
npm run demo:extraction   # Step 2 demo over local synthetic fixtures
npm run demo:automation   # Step 3 offline demo with the mock provider
```

Step 4 additionally needs a database and `.env`:

```bash
cd backend
docker compose up -d      # local PostgreSQL 16 (optional)
cp .env.example .env      # set DATABASE_URL / PORT / FRONTEND_URL
npm run db:deploy         # apply committed migrations
npm run api:start         # http://localhost:4000/api/health
```

If Prisma reports a different database than the one in `.env`, an inherited
`DATABASE_URL` environment variable is overriding the file (dotenv does not
overwrite existing process variables). Check it with `$env:DATABASE_URL` in
PowerShell. Either remove that user-level variable and open a new terminal, or
set the local value for the current session before starting the API:

```powershell
$env:DATABASE_URL = "postgresql://arrt:arrt@localhost:5432/arrt?schema=public"
npm run db:deploy
npm run api:start
```

Full schema, endpoint and response contract:
[`docs/database-and-api.md`](../docs/database-and-api.md).

## Step 1 usage

```js
const {
  generateCombinations,
  generateAlphabetPatterns,
  matchesWildcard,
  findMatchingNames,
} = require('./src');

const result = generateCombinations({
  firstNames: ['Chris', 'Christian'],
  lastNames: ['Adams', 'Anderson'],
});

// {
//   totalCombinations: 4,
//   combinations: [
//     { firstName: 'Chris', lastName: 'Adams' },
//     { firstName: 'Chris', lastName: 'Anderson' },
//     { firstName: 'Christian', lastName: 'Adams' },
//     { firstName: 'Christian', lastName: 'Anderson' }
//   ]
// }

generateAlphabetPatterns(); // ['A*', 'B*', ..., 'Z*']
generateAlphabetPatterns({ characters: 'AB', prefix: 'Mc' }); // ['McA*', 'McB*']

matchesWildcard('CHRISTIAN', 'Chris*'); // true
findMatchingNames(['Chris', 'Adam', 'Bob'], ['A*']); // ['Adam']
```

Inputs may be strings, comma/newline separated strings, or arrays.

## Step 2 usage

```js
const { extractRecords } = require('./src');

const result = extractRecords([
  'src/extraction/fixtures/page-1.html',
  { fixturePath: 'src/extraction/fixtures/page-2.html', page: 2 },
]);

console.log(result);
// {
//   totalRows, acceptedCount, rejectedCount, duplicateCount,
//   records: [
//     {
//       fullName, city, state, credentialString,
//       recordId,                    // only when the source exposes one
//       source: { page, fixture, sourceUrl, rowNumber, sourceRowIndex }
//     }
//   ],
//   rejectedRows: [
//     {
//       code, errors: [{ code, field, message, value? }],
//       values, rawValues, recordId, source
//     }
//   ],
//   stats: { ... }
// }
```

Inline HTML and page objects are also accepted:

```js
extractRecords({
  html: '<table><tr><th>Name</th>...</tr></table>',
  page: 1,
  fixture: 'inline.html',
});
```

### Count semantics

```text
totalRows = acceptedCount + rejectedCount + duplicateCount
```

- `acceptedCount` — rows that produced a valid record.
- `rejectedCount` — rows that failed validation or were structurally malformed.
- `duplicateCount` — valid rows that matched an earlier record.
- Duplicates are **neither accepted nor rejected**.
- Rows intentionally ignored at the table level (for example
  `No results found.`) are excluded from `totalRows` and reported through
  `stats.ignoredRowCount` / `stats.ignoredRows`.

Full contract, error codes and fixture matrix:
[`docs/step-2-extraction.md`](../docs/step-2-extraction.md).

## Step 1 rules and hardening

- `*` matches zero or more characters. Names and patterns are case-insensitive.
- Wildcard matching uses a bounded two-pointer matcher, not a backtracking
  regex. `wildcardToRegExp()` is retained for compatibility but is capped at
  four wildcards and documents that `matchesWildcard()` should be used for
  untrusted or complex patterns.
- Patterns are capped at 100 characters; validation caps a name at 50
  characters and allows at most 8 wildcards.
- Validation reports a primary cause rather than overlapping noise. For
  example, `validateName('*', { allowWildcards: false })` returns only
  `WILDCARD_NOT_ALLOWED`.
- `generateCombinations()` is capped by `maxCombinations` (default **10,000**)
  and throws `TOO_MANY_COMBINATIONS` with the requested/actual counts.
- `undefined` options mean defaults; `null`, arrays, unknown keys and invalid
  option values produce a descriptive `INVALID_OPTIONS` error.
- Duplicate names and duplicate pairs are removed case-insensitively while
  preserving the first spelling and input order.

## Step 2 behavior summary

- Columns are identified by **header labels**, never fixed positions.
  Reordered columns are supported.
- Default required header for table location is `fullName`. If `city`, `state`
  or `credentialString` columns are absent, rows are rejected with the
  corresponding `MISSING_*` code instead of being silently dropped. Pass
  `requiredHeaders` to make additional headers mandatory at the page level.
- Missing cells, missing columns, empty values and malformed rows are preserved
  in `rejectedRows` with error codes and source provenance.
- States are normalized to USPS codes when recognized. Unrecognized values are
  preserved and reported as `INVALID_STATE` — never silently discarded.
- Credential strings are **not** reformatted or format-validated. Synthetic
  fixtures use the placeholder format `TEST-0001`, `TEST-0002`, etc. A real
  credential format must not be invented; define it only from authorized
  samples later.
- Duplicate detection prefers a source `recordId`. Otherwise it uses the
  documented composite key of normalized name + city + state + credential
  string. `credentialString` alone is never used.
- Inputs are capped (`maxBytes`, `maxPages`, `maxRows`) and remote URLs are
  rejected.

## Step 3 usage

The automation layer is provider-based. The mock provider runs entirely offline
over the Step 2 fixtures:

```js
const { createMockProvider, collectRecords } = require('./src');

const provider = createMockProvider({
  fixtures: [
    'normal.html',
    'page-1.html',
    'page-2.html',
  ],
});

const result = await collectRecords(
  [
    { firstName: 'Alice', lastName: 'Smith' },
    { firstName: 'Cross', lastName: 'Person' },
    { firstName: 'Second', lastName: 'Person' },
  ],
  {
    provider,
    minIntervalMs: 0,      // demo only; defaults to 5000
    maxRetries: 0,
    target: { min: 300, max: 350 },
  }
);

console.log(result.records);
```

The result contains `status`, `stopReason`, `totalRows`, `acceptedCount`,
`rejectedCount`, `duplicateCount`, `records`, `rejectedRows` and a `stats`
object with extraction, monitoring, pacing, circuit-breaker and target details.

### Provider contract

```js
{
  id: 'mock-fixtures',
  mode: 'mock',              // 'mock' | 'live'
  requiresBrowser: false,
  async fetchPage(search, context) {
    return {
      html: '<table>...</table>', // required for non-error statuses
      status: 200,                // optional, defaults to 200
      url: 'mock://search/1',
      fixture: 'normal.html',     // optional provenance
      sourceUrl: 'mock://search/1',
      captcha: null,              // or { present, type?, siteKey? }
      headers: {},                // e.g. Retry-After
      pageNumber: 1,
    };
  }
}
```

The provider never writes records and never bypasses access controls.

### Safety gates

A live provider is refused unless **all** of these are supplied:

- `allowLiveProvider: true`
- `authorization.confirmed: true`
- a non-empty `authorization.reference`

The ARRT adapter additionally requires CAPTCHA approval, and even then throws
`CAPTCHA_REQUIRES_APPROVAL` with `implementedSolver: false`. No solver, token
injection, stealth or proxy rotation is implemented.

### Monitoring and stop behavior

- `request-monitor.js` records status, duration, retry count, CAPTCHA presence,
  timeout/connection outcomes, timestamps and optional IP label. It summarizes
  `403`, `429`, `4xx`, `5xx`, CAPTCHA, timeout, connection failures and duration
  percentiles.
- `error-monitor.js` classifies timeouts, connection/DNS/TLS failures, access
  denial, rate limiting, CAPTCHA, authorization, extraction, browser and
  provider errors.
- `ip-monitor.js` groups observations by a caller-supplied label only. It does
  not discover or rotate IPs and reports `rotationImplemented: false`.

Stop reasons: `PLAN_EXHAUSTED`, `TARGET_REACHED`, `REQUEST_LIMIT_EXCEEDED`,
`ACCESS_DENIED`, `RATE_LIMITED`, `CAPTCHA_DETECTED`, `CIRCUIT_OPEN`,
`REQUEST_TIMEOUT`, `PROVIDER_ERROR`, `AUTHORIZATION_REQUIRED`,
`EXTRACTION_FAILED`.

### Default automation limits

These are conservative internal safety values, **not** ARRT limits:

| Setting | Default |
| --- | --- |
| Minimum interval between requests | 5,000 ms |
| Max requests per run | 100 |
| Max retries | 2 |
| Backoff base / factor / cap | 2,000 ms / 2 / 60,000 ms |
| Jitter | 0.2 |
| Circuit failure threshold | 3 |
| Circuit reset timeout | 60,000 ms |
| Target records | 300–350 |

`Retry-After` is honored as authoritative and is never shortened to the
exponential cap.

### ARRT adapter status

`arrt.adapter.js` encodes only observed public-page facts: selectors, the
`/VerifyCredentials/SearchByName` and `/VerifyCredentials/GetDisplayDetails`
paths, the reCAPTCHA v2 checkbox and site key, the anti-forgery header, and the
HTTP 424 CAPTCHA-failure branch. It can analyze saved HTML and parse saved
result fragments offline, but live `fetchPage()` is inert.

Investigation and architecture documents:

- [`docs/captcha-investigation.md`](../docs/captcha-investigation.md)
- [`docs/ip-blocking-investigation.md`](../docs/ip-blocking-investigation.md)
- [`docs/automation-architecture.md`](../docs/automation-architecture.md)
- [`docs/technical-challenges.md`](../docs/technical-challenges.md)

## Step 4 usage

The API follows Routes → Controllers → Services → Repositories → Prisma. Only
repositories touch Prisma, and `createApp({ prisma, config, logger })` accepts an
injected client, so HTTP tests run without a database.

```js
const { createApp } = require('./src/api/app');

const app = createApp({
  prisma,                                  // real PrismaClient or test double
  config: { frontendOrigins: ['http://localhost:3000'] },
});
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness/readiness; `503 degraded` if PostgreSQL is unreachable. |
| `GET /api/records` | Paginated records; name search, state/city/credential filters, whitelisted sorting. |
| `GET /api/records/:id` | One record by UUID. |
| `POST /api/records/import` | Normalize/validate rows, insert new records, skip duplicates, report counts. |
| `GET /api/jobs` | Paginated jobs, optional `status` filter. |
| `GET /api/jobs/:id` | Job counters plus ordered logs. |
| `POST /api/jobs` | Create a `PENDING` job and first log only; no live collection. |
| `GET /api/dashboard/stats` | Totals, completed/failed jobs, recent records, by state, by credential type. |

Imports reuse the Step 2 normalizer/validator. Identity is the composite
normalized name + city + state + credential, because ARRT exposes no stable
record id. Errors return `{ error: { code, message, details? }, requestId }`
without stack traces, SQL or driver messages. CORS allows exactly `FRONTEND_URL`.

## API overview

### Step 1

| Function | Purpose |
| --- | --- |
| `generateCombinations({ firstNames, lastNames }, options)` | Validated cartesian product with duplicate removal. Options: `sort`, `maxLength`, `allowWildcards`, `allowBareWildcard`, `maxCombinations`. |
| `generateAlphabetPatterns(options)` | Alphabetical patterns. Options: `characters`, `prefix`, `suffix`, `length` (1–3), `casing`, `maxPatterns`. |
| `wildcardToRegExp(pattern, options)` | Compatible wildcard-to-RegExp helper; at most 4 wildcards. Prefer `matchesWildcard`. |
| `matchesWildcard(value, pattern, options)` | Bounded, case-insensitive wildcard test. |
| `findMatchingNames(names, patterns)` | Filters names by any pattern. |
| `normalizeName` / `normalizeWhitespace` / `toNameKey` | Normalization and comparison keys. |
| `validateName` / `assertValidName` / `validateNameList` | Non-throwing and throwing validators. |

### Step 2

| Function | Purpose |
| --- | --- |
| `extractRecords(input, options)` | Main extraction service. Returns accepted records, rejected rows, duplicate counts and statistics. |
| `loadPage` / `loadPages` / `loadFixture` | Local HTML source loading with size/page limits. |
| `parseHtml(html, context)` | Cheerio parse wrapper; no script execution or resource loading. |
| `mapHeaders(labels, options)` | Header-label → column-index mapping with aliases and duplicate detection. |
| `locateResultsTable($, options)` | Finds the best-matching results table by headers. |
| `extractRows($, tableInfo, options)` | Raw row extraction with provenance. |
| `normalizeFullName` / `normalizeCity` / `normalizeState` / `normalizeCredentialString` | Field normalization. |
| `validateRecordValues(values)` | Returns all field errors for a normalized row. |
| `buildDedupeKey(record)` / `createDuplicateTracker()` | Documented dedupe strategy, including cross-page tracking. |
| `buildStatistics(...)` | Counts, per-page reports, error counts and duplicate diagnostics. |

`extractRecords` options: `maxBytes`, `maxPages`, `maxRows`, `tableSelector`,
`aliases`, `requiredHeaders`, `noResultsPattern`, `dedupe`.

### Step 3

| Function | Purpose |
| --- | --- |
| `collectRecords(searches, options)` | Runs provider-backed collection with limits, retries, stop reasons and monitoring. |
| `createMockProvider(options)` | Deterministic offline provider over local fixtures; supports scripted errors, timeouts, 403/429 and CAPTCHA. |
| `assertProvider` / `normalizeProviderResult` | Validate the provider contract and normalize each page result. |
| `createArrtAdapter(options)` | Inert ARRT adapter with offline `analyzePage()` and `parseResultsHtml()`. |
| `createRateLimiter(options)` | Minimum interval and optional rolling-window request cap. |
| `createBackoffPolicy(options)` / `parseRetryAfter(value)` | Exponential backoff, jitter and `Retry-After` parsing. |
| `createCircuitBreaker(options)` | Closed/open/half-open failure gate. |
| `createRequestMonitor` / `createErrorMonitor` / `createIpMonitor` | Telemetry, error classification and denial tracking. |
| `createBrowserService(options)` | Lazy Puppeteer lifecycle; reports `BROWSER_UNAVAILABLE` when absent. |
| `createSessionManager(options)` | Session/page/request bookkeeping. |
| `createPageHandler(options)` / `detectCaptchaInHtml(html)` | Navigation/form helpers and CAPTCHA detection. |
| `createDefaultConfig()` / `mergeConfig(overrides)` | Deep-frozen conservative defaults. |

### Step 4

| Function | Purpose |
| --- | --- |
| `createApp({ prisma, config, logger })` | Express app factory with routes, validation, CORS and error handling. |
| `createRecordRepository` / `createJobRepository` | All Prisma queries for records, jobs and logs. |
| `createImportService` | Normalize/validate imported rows, insert, skip duplicates, count outcomes. |
| `deriveCredentialType` / `groupByCredentialType` | Structural credential-type heuristic used only for dashboard grouping. |
| `ApiError` / `mapError` | Safe operational errors and Prisma-code → HTTP status mapping. |

## Fixtures

Synthetic fixtures live in `backend/src/extraction/fixtures/` and contain no
real PII:

| Fixture | Case |
| --- | --- |
| `normal.html` | Normal results table |
| `reordered-columns.html` | Headers in a different order |
| `missing-fields.html` | Missing city / state cells |
| `missing-column.html` | Entire city column absent |
| `missing-credentials.html` | Missing credential values |
| `duplicates.html` | Duplicate rows using the composite key |
| `record-ids.html` | Duplicate rows using a source record ID |
| `page-1.html` / `page-2.html` | Cross-page duplicate detection |
| `empty-results.html` | Empty results / “No results found.” |
| `malformed.html` | Malformed HTML and malformed rows |
| `unfamiliar-state.html` | Unrecognized state preserved and rejected |
| `multiple-tables.html` | Results table selected among unrelated tables |
| `mismatched-headers.html` | No recognizable result headers |
| `no-table.html` | No table at all |

## Verification

Last run on Node 22.20.0:

- `npm test`: **136/136 passing**
  - 22 original Step 1 tests
  - 12 Step 1 hardening regression tests
  - 30 Step 2 extraction tests
  - 37 Step 3 automation tests
  - 11 manual-search tests
  - 24 Step 4 API tests (in-memory Prisma double, no database)
- `node --check`: passed for every JavaScript file under `src/`
- `npx prisma validate`: schema valid
- `npm run demo:extraction`: 8 candidate rows, 7 accepted, 1 duplicate,
  0 rejected, 3 pages processed
- `npm run demo:automation`: 8 candidate rows, 7 accepted, 1 cross-page
  duplicate, 0 rejected, 3 requests, stop reason `PLAN_EXHAUSTED`

## Limitations (intentional)

- No live ARRT access, live search request, pagination crawling, CAPTCHA
  solving/bypass, stealth, proxy rotation or IP switching.
- Puppeteer is not installed; the browser service lazy-loads it and reports
  `BROWSER_UNAVAILABLE` when absent.
- No frontend, and no authentication/authorization on the API. Add auth before
  any non-local deployment.
- `POST /api/jobs` does not run collection; it only records intent.
- Dashboard credential grouping is a structural heuristic, not an authoritative
  ARRT classification.
- Dedupe relies on the composite identity key because ARRT exposes no stable
  record id; a legitimate city or credential change creates a new row.
- The API tests use an in-memory Prisma double. Run `npm run db:deploy` and a
  smoke request to verify a real PostgreSQL instance.
- The ARRT adapter's live path is inert even when authorization and CAPTCHA
  approval are supplied, because no solver or token-injection implementation
  exists.
- `rowspan` is not expanded; `colspan` is expanded up to 50 columns.
- Unrecognized state values are rejected rather than guessed.
- Diacritic folding policy is still undecided; `Jose` and `José` remain distinct
  comparison keys for now.
- Credential format validation is deliberately format-agnostic.
- Default automation limits are internal safety values, not ARRT-published or
  measured limits. Actual 403/429 behavior and 2Captcha latency are unmeasured.
