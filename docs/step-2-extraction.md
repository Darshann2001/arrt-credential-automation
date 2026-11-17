# Step 2 — Fixture-Driven Extraction Engine

**Status:** implemented and verified  
**Date:** 2026-11-17  
**Scope:** offline extraction from local/synthetic HTML only  
**Dependency:** `cheerio@1.0.0` (pinned for Node 18.17+ compatibility)

---

## 1. Scope and constraints

This phase converts saved/synthetic ARRT-style result tables into validated
records. It does **not**:

- contact ARRT or fetch any remote URL;
- launch a browser, use Puppeteer/Playwright, or solve CAPTCHAs;
- crawl pagination links;
- connect to PostgreSQL;
- expose Express APIs;
- include a frontend.

“Multiple pages” means an ordered array of page sources supplied by the caller.
The loader rejects `http://` and `https://` strings. No live collection is
implemented in this phase.

All committed fixtures are synthetic and use placeholder credentials of the form
`TEST-0001`. No real credential format is inferred or invented.

---

## 2. Architecture

| Stage | Module | Responsibility |
| --- | --- | --- |
| 1. HTML loader | `src/extraction/html-loader.js` | Accept inline HTML, fixture paths or page objects; enforce `maxBytes`/`maxPages`; attach page/fixture/source metadata. Reject remote URLs. |
| 2. DOM parser | `src/extraction/dom-parser.js` | Cheerio parse wrapper; no script execution or resource loading. |
| 3. Table locator | `src/extraction/table-locator.js` | Find the best table by scanning header-like rows; never assumes table position. |
| 4. Header mapper | `src/extraction/column-mapper.js` | Map header labels/aliases to column indexes; detect missing and duplicate headers. |
| 5. Row extractor | `src/extraction/row-extractor.js` | Read rows below the header, expand `colspan`, skip repeated headers and no-results rows, preserve provenance. |
| 6. Field normalizer | `src/extraction/field-normalizer.js` | Collapse whitespace, normalize names/places, map recognized states to USPS codes, preserve credential text. |
| 7. Field validator | `src/extraction/field-validator.js` | Required-field, character, length and state validation with descriptive codes. |
| 8. Record builder | `src/extraction/record-builder.js` | Build accepted records and rejected-row diagnostics with normalized/raw values and source provenance. |
| 9. Duplicate detector | `src/extraction/duplicate-detector.js` | Record-ID-first dedupe with documented composite fallback, shared across pages. |
| 10. Statistics | `src/extraction/statistics.js` | Consistent counts, per-page reports, error counts, duplicate strategies and ignored-row details. |
| Orchestration | `src/extraction/extractor.service.js` | Runs the pipeline and returns the public result object. |

Supporting modules: `errors.js` (error taxonomy), `fields.js` (field names),
`index.js` (extraction barrel), `demo.js` (offline demo).

The public API re-exports the extraction layer from `src/index.js`.

---

## 3. Public contract

### 3.1 Main entry point

```js
const { extractRecords } = require('./src');

const result = extractRecords(input, options);
```

`input` may be:

- an HTML string;
- a local fixture path;
- a page object `{ html | fixturePath | path, page?, fixture?, sourceUrl? }`;
- an array of any of the above;
- `{ pages: [...] }`.

`sourceUrl` is metadata only. It is never fetched.

### 3.2 Options

| Option | Default | Description |
| --- | --- | --- |
| `maxBytes` | `2097152` | Maximum UTF-8 bytes per page. |
| `maxPages` | `100` | Maximum number of page sources. |
| `maxRows` | `10000` | Maximum candidate rows processed before `ROW_LIMIT_EXCEEDED`. |
| `tableSelector` | `null` | Optional CSS selector limiting table search. |
| `aliases` | built-in aliases | Custom `field -> alias[]` map for headers. |
| `requiredHeaders` | `['fullName']` | Headers that must be present for the page (otherwise `HEADER_MISMATCH`). |
| `noResultsPattern` | built-in RegExp | Pattern identifying a single-cell “no results” row. |
| `dedupe` | `true` | Set `false` to accept all valid rows without duplicate filtering. |

Invalid options produce `ExtractionError` with code `INVALID_OPTIONS`. `null`
options are invalid; `undefined` means defaults.

### 3.3 Output shape

```json
{
  "totalRows": 10,
  "acceptedCount": 8,
  "rejectedCount": 2,
  "duplicateCount": 1,
  "records": [],
  "rejectedRows": [],
  "stats": {}
}
```

The example numbers above are illustrative only. This implementation enforces:

```text
totalRows = acceptedCount + rejectedCount + duplicateCount
```

### 3.4 Accepted record

```json
{
  "fullName": "Alice Smith",
  "city": "Springfield",
  "state": "IL",
  "credentialString": "TEST-0001",
  "recordId": null,
  "source": {
    "page": 1,
    "fixture": "normal.html",
    "sourceUrl": null,
    "rowNumber": 1,
    "sourceRowIndex": 2
  }
}
```

- `recordId` is `null` unless the source table has a mapped `Record ID` column.
- `rowNumber` is the 1-based position among rows after the detected header.
- `sourceRowIndex` is the 1-based `<tr>` position in the table.

### 3.5 Rejected row

```json
{
  "code": "MISSING_CITY",
  "errors": [
    {
      "code": "MISSING_CITY",
      "field": "city",
      "message": "city is required and must be a non-empty string."
    }
  ],
  "values": {
    "fullName": "Missing City Person",
    "city": "",
    "state": "IL",
    "credentialString": "TEST-2001",
    "recordId": ""
  },
  "rawValues": {
    "fullName": "Missing City Person",
    "city": "",
    "state": "IL",
    "credentialString": "TEST-2001"
  },
  "recordId": null,
  "source": { "page": 1, "fixture": "missing-fields.html", "rowNumber": 1 }
}
```

`values` contains normalized values; `rawValues` retains the cell text as
extracted (after HTML entity decoding). Invalid state values are preserved in
both, so no unfamiliar value is silently discarded.

---

## 4. Count semantics

| Field | Meaning |
| --- | --- |
| `totalRows` | Candidate data rows processed. Excludes table-level ignored rows. |
| `acceptedCount` | Rows that produced a valid record. Equals `records.length`. |
| `rejectedCount` | Rows that failed validation or were malformed. Equals `rejectedRows.length`. |
| `duplicateCount` | Valid rows that matched an earlier record. |
| `stats.ignoredRowCount` | Rows intentionally skipped (repeated headers, no-results message). Not part of `totalRows`. |

**Duplicates are not counted as accepted or rejected.** They are counted only in
`duplicateCount`. A row is validated before duplicate detection, so an invalid
row is always rejected, never treated as a duplicate.

Pending review: if duplicate rows should also be returned in full, this can be
added without changing the count formula. Current duplicate diagnostics are in
`stats.duplicates`.

---

## 5. Header mapping and table location

Headers are normalized by:

1. removing zero-width characters;
2. collapsing/trimming whitespace;
3. lowercasing;
4. stripping trailing `:` / `*`;
5. replacing non-alphanumeric characters with spaces.

Built-in aliases include:

| Field | Examples |
| --- | --- |
| `fullName` | `Name`, `Full Name`, `Credential Holder`, `Licensee Name` |
| `city` | `City`, `Town`, `Municipality` |
| `state` | `State`, `State or Province`, `Province`, `St` |
| `credentialString` | `Credential`, `Credential Number`, `License Number`, `Registration Number` |
| `recordId` | `Record ID`, `Record Identifier`, `Source ID`, `ID` |

Column positions are never hardcoded. Reordered columns and aliases are
supported. Duplicate mapped headers keep the first occurrence and are reported
in `stats.pages[n].duplicateHeaders`.

The locator scans up to the first five rows of each table, scores header matches,
and chooses the best table. The extraction service requires only `fullName` by
default. Missing `city`/`state`/`credentialString` **columns** therefore become
row-level rejections. Callers can require more headers through
`requiredHeaders`.

If no table exists → `TABLE_NOT_FOUND`. If no table has a recognizable header,
or a required header is absent → `HEADER_MISMATCH`.

---

## 6. Row handling

| Situation | Behavior |
| --- | --- |
| Row before/including header | Ignored. |
| Repeated header row below header | Ignored; `stats.ignoredRows` records `repeated-header`. |
| Single-cell “No results found.” | Ignored; recorded as `no-results`; not counted in `totalRows`. |
| Missing cells / short row | Mapped missing values become `null`; field validation rejects with `MISSING_*`. |
| Empty cell | Normalized to `""`; rejected with `MISSING_*`. |
| Entire row empty | Rejected with `MALFORMED_ROW`. |
| Row with no mapped values | Rejected with `MALFORMED_ROW`. |
| `colspan` | Expanded up to 50 columns. |
| `rowspan` | Not expanded in this phase; documented limitation. |
| Nested tables | Only direct rows of the selected table are used. |

No rejected row is dropped silently. Every rejected row carries a primary
`code`, an `errors` array and provenance.

---

## 7. Field rules

### `fullName`

- Whitespace collapsed/trimmed.
- Curly apostrophes/dashes normalized.
- Comma-separated and suffix display forms preserved
  (`Smith, John Jr.`).
- Must contain at least one letter.
- Allowed characters: Unicode letters/marks, spaces, periods, apostrophes,
  hyphens and commas.
- Max length: 120.

### `city`

- Same whitespace/typographic normalization as names.
- Must contain at least one letter.
- Max length: 80.

### `state`

- Recognized full names and postal codes are normalized to the USPS code
  (`Illinois` → `IL`, `n.y.` → `NY`).
- Supported set: 50 states, DC, PR, VI, GU, AS, MP and military codes
  AA/AE/AP.
- Unrecognized values are preserved and rejected as `INVALID_STATE`.
- Never guessed or discarded.

### `credentialString`

- Whitespace normalized; no format inference or reformatting.
- Must be non-empty, printable, max length 100.
- Placeholder fixture format: `TEST-0001`, `TEST-0002`, etc.
- A real format regex must only be introduced from authorized samples.

### Validation codes

`MISSING_FULL_NAME`, `MISSING_CITY`, `MISSING_STATE`, `MISSING_CREDENTIAL`,
`INVALID_FULL_NAME`, `INVALID_CITY`, `INVALID_STATE`, `INVALID_CREDENTIAL`,
`MALFORMED_ROW`.

Page-level codes: `NO_PAGES`, `INVALID_INPUT`, `INVALID_PAGE_SOURCE`,
`UNSUPPORTED_SOURCE`, `EMPTY_HTML`, `HTML_TOO_LARGE`, `INVALID_HTML`,
`INVALID_OPTIONS`, `TABLE_NOT_FOUND`, `HEADER_MISMATCH`,
`ROW_LIMIT_EXCEEDED`, `PAGE_LIMIT_EXCEEDED`.

---

## 8. Duplicate detection

### Preferred strategy: source record ID

If the table exposes a reliable record identifier, dedupe uses only:

```text
record-id:<normalized lowercase record ID>
```

If two rows share the ID but have different names or credentials, the later row
is still a duplicate. This is deliberate: the source ID is considered the
authoritative identity signal. Such conflicts can be audited through
`stats.duplicates`.

### Fallback strategy: documented composite key

```text
composite:<normalized full name>\0<normalized city>\0<normalized state>\0<normalized credential string>
```

- Name and city use the case-insensitive name comparison key.
- State uses the normalized USPS code (or preserved unknown value on rejected
  rows).
- Credential is compared case-insensitively after whitespace normalization.
- The credential string is **never used alone**.
- An empty credential is represented as an empty component; a missing credential
  row is rejected before dedupe anyway.
- The composite means two listings with the same person/city/state but different
  credentials are **not** considered duplicates. This follows the approved
  strategy and avoids merging distinct credentials.

A single tracker is created per `extractRecords()` call, so dedupe works across
all supplied pages. The first occurrence is kept, and its page/row provenance is
recorded in `stats.duplicates[n].duplicateOf`.

Known limitation: spelling variants such as `St. Louis` vs `Saint Louis`, or
diacritic variants such as `Jose` vs `José`, are not folded. The diacritic
policy remains undecided for the future database key.

---

## 9. Statistics

`stats` contains:

| Field | Meaning |
| --- | --- |
| `pagesProcessed` | Number of page sources processed. |
| `candidateRows` / `totalRows` | Same as top-level `totalRows`. |
| `acceptedCount` / `rejectedCount` / `duplicateCount` | Same as top-level counts. |
| `ignoredRowCount` / `ignoredRows` | Ignored rows and reasons/provenance. |
| `countsConsistent` | `true` when the count invariant holds. |
| `acceptanceRate` / `rejectionRate` / `duplicateRate` | Fractions of `totalRows`; sum to 1 when `totalRows > 0`. |
| `primaryErrorsByCode` | Rejected rows counted by primary code. |
| `allErrorsByCode` | Every error occurrence, including secondary field errors. |
| `duplicateStrategies` | Duplicate counts by `record-id` / `composite`. |
| `duplicates` | Duplicate summaries with provenance and first occurrence. |
| `pages` | Per-page header, column map, duplicate-header and count details. |
| `durationMs` | Wall-clock extraction duration (non-deterministic). |

`durationMs` is the only non-deterministic value. Tests assert counts, rates,
records and provenance, not exact duration.

---

## 10. Fixture matrix

Location: `backend/src/extraction/fixtures/`

| Fixture | Purpose |
| --- | --- |
| `normal.html` | Normal table; entity decoding and whitespace normalization. |
| `reordered-columns.html` | Header-based mapping with columns in a different order. |
| `missing-fields.html` | Empty city and state cells. |
| `missing-column.html` | Entire city column absent. |
| `missing-credentials.html` | Empty credential cell. |
| `duplicates.html` | Same composite record twice; same person with a different credential stays accepted. |
| `record-ids.html` | Record-ID-first dedupe despite changed name/credential. |
| `page-1.html`, `page-2.html` | Cross-page duplicate detection. |
| `empty-results.html` | Header-only table with a `colspan` “No results found.” row. |
| `malformed.html` | Unclosed tags, an all-empty row and a short row. |
| `unfamiliar-state.html` | `Ontario` preserved and rejected as `INVALID_STATE`. |
| `multiple-tables.html` | Navigation table plus results table. |
| `mismatched-headers.html` | No recognizable result headers. |
| `no-table.html` | No `<table>` at all. |

All fixtures are synthetic. No real PII and no real credential values.

---

## 11. Tests and verification

Test files:

- `src/tests/name-generator.test.js` — original 22 Step 1 tests.
- `src/tests/name-hardening.test.js` — 12 Step 1 hardening regression tests.
- `src/tests/extraction.test.js` — 30 Step 2 tests.

Step 2 tests cover:

- fixture, inline and page-object loading; remote-URL rejection; size limits;
- malformed DOM recovery;
- reordered/aliased/duplicate/missing headers;
- results-table selection among unrelated tables;
- `colspan`, repeated headers and provenance;
- normalization and validation, including unfamiliar states;
- record-ID and composite dedupe keys;
- normal extraction, missing fields/columns/credentials;
- in-page and cross-page duplicates;
- empty results, malformed rows and malformed HTML;
- `tableSelector`, `requiredHeaders`, `maxRows`, invalid options;
- count invariance across every fixture.

Actual last run (Node 22.20.0):

```text
npm test
tests 64
pass 64
fail 0
```

`node --check` passed for every JavaScript file under `backend/src/`.

`npm run demo:extraction`:

```text
totalRows: 8
acceptedCount: 7
rejectedCount: 0
duplicateCount: 1
pagesProcessed: 3
duplicateStrategies: { composite: 1 }
```

---

## 12. Security and compliance notes

- HTML is untrusted input: no script execution, no resource fetching, size caps.
- Remote URLs are rejected by the loader; the extractor never downloads.
- Rejected rows retain raw text for debugging; production logging should avoid
  full PII and log counts/error codes instead.
- Raw HTML is not persisted by this phase.
- Collection from ARRT remains unauthorized/not implemented in this phase.
- Credential format validation must be derived only from authorized samples.

---

## 13. Known limitations and next-step hooks

1. `rowspan` is not expanded.
2. No live pagination discovery; pages must be supplied explicitly.
3. State set is U.S.-centric; foreign values are rejected and preserved.
4. Diacritic folding policy is undecided.
5. Credential validation is format-agnostic by design.
6. Duplicate details are summarized in `stats.duplicates`; full duplicate
   records are not included in `records` or `rejectedRows`.
7. Page-level failures throw and abort the run. Per-page failure isolation and
   `failFast` could be added when live collection is introduced.
8. Future PostgreSQL work should use a unique key consistent with the documented
   record-ID-first/composite strategy, not `credentialString` alone.
