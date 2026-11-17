# ARRT Project — Step 1 Implementation Audit

**Date:** 2026-11-17
**Scope:** Read-only review of the repository as it stands after Step 1. No existing
source files were modified. This document is the only new file.
**Environment:** Windows, Node.js v22.20.0, npm 10.9.3.
**Repository state:** `automation.md` plus `backend/`. Not a git repository. No
`node_modules`, no runtime or dev dependencies, no root workspace `package.json`.

---

## 1. Existing Features and Implementation Locations

### 1.1 Project structure

| Path | Responsibility |
| --- | --- |
| `backend/package.json` | Package metadata, scripts, Node >=18 engine |
| `backend/README.md` | Phase 1 usage and rules |
| `backend/src/index.js` | Public API barrel + guarded CLI demo |
| `backend/src/utils/name-normalizer.util.js` | List parsing, whitespace/name normalization, dedupe keys, sorting |
| `backend/src/utils/wildcard.util.js` | Safe `*` → RegExp conversion, matching, pattern filtering |
| `backend/src/validators/name.validator.js` | Name/pattern validation and error taxonomy |
| `backend/src/services/name-generator.service.js` | Combination generator and alphabetical pattern generator |
| `backend/src/tests/name-generator.test.js` | 22 unit tests via `node:test` |

### 1.2 Feature map

| Feature | Implementation | Notes |
| --- | --- | --- |
| Single/multiple/comma/newline input | `name-normalizer.util.js:25-49` | Strings and arrays supported |
| Whitespace normalization | `name-normalizer.util.js:57-63` | Unicode spaces collapsed/trimmed |
| Name canonicalization | `name-normalizer.util.js:77-82` | Curly apostrophes/dashes normalized, spaces around `-`/`'` removed, casing preserved |
| Case-insensitive dedupe | `name-normalizer.util.js:101-123` | First spelling wins |
| Case-insensitive comparison key | `name-normalizer.util.js:90-92` | `toLowerCase()` based |
| Alphabetical sorting | `name-normalizer.util.js:131-139` | `localeCompare('en', { sensitivity: 'base' })` |
| Wildcard normalization | `wildcard.util.js:27-40` | Trims/collapses whitespace, collapses repeated `*` |
| Safe wildcard → RegExp | `wildcard.util.js:48-74` | Regex metacharacters escaped, anchored, case-insensitive, optional prefix mode |
| Wildcard matching | `wildcard.util.js:84-90` | Non-string values return `false` |
| Pattern filtering | `wildcard.util.js:112-152` | Preserves order, dedupes matches case-insensitively |
| Empty/type/length/character validation | `name.validator.js:55-141` | Non-throwing result object |
| Assertion-style validation | `name.validator.js:152-159`, `236-252` | Throws `NameValidationError` |
| List validation with entry indexes | `name.validator.js:169-227` | Per-entry error objects |
| Error taxonomy | `name.validator.js:24-41` | `code`, `field`, `value`, `errors` |
| Cartesian combination generator | `name-generator.service.js:71-100` | Order-preserving, duplicate-pair removal |
| Alphabetical pattern generator | `name-generator.service.js:118-169` | Configurable charset, prefix, suffix, length, casing, cap |
| Public exports | `index.js:19-49` | Stable barrel for future phases |
| Demo entry point | `index.js:51-64`, `package.json:8-10` | `npm start` |

### 1.3 Test coverage by requirement

All Step 1 required cases are present in `name-generator.test.js`:

- single and multiple combinations (lines 27-56)
- duplicate names/pairs (58-82)
- empty/missing inputs (110-132)
- wildcard generation, preservation and matching (145-171, 243-285)
- invalid characters and allowed name punctuation (194-217)
- case-insensitive matching (254-266)
- alphabetical pattern generation and options (287-365)
- normalization, sorting, JSON serialization (84-108, 173-192)

Tests use only `node:test` and `node:assert/strict`; there are no mocks or
network calls.

### 1.4 Documentation

`README.md` documents install-free usage, API, wildcard rules and validation
rules. It accurately reflects the code, with one ambiguity noted in §3.

---

## 2. Actual Execution Results (re-run during this audit)

### 2.1 `npm test`

```
> node --test src/tests/name-generator.test.js
1..22
# tests 22
# pass 22
# fail 0
# duration_ms 133.1114
```

**Result: 22/22 passing, 0 failing.**

### 2.2 Coverage (`node --test --experimental-test-coverage`)

| File | Line % | Branch % | Funcs % |
| --- | ---: | ---: | ---: |
| `src/index.js` | 81.25 | 50.00 | 100.00 |
| `src/services/name-generator.service.js` | 92.81 | 85.29 | 100.00 |
| `src/utils/name-normalizer.util.js` | 88.96 | 79.17 | 87.50 |
| `src/utils/wildcard.util.js` | 91.36 | 73.08 | 100.00 |
| `src/validators/name.validator.js` | 92.86 | 81.25 | 100.00 |
| **All files** | **93.60** | **84.98** | **98.80** |

Main uncovered areas are guard branches for wrong types, the `REQUIRES_LETTER`
path, the assertion throw path, unused defensive branches (e.g. duplicate-pair
skip after list dedupe), and the CLI demo block. No uncovered happy path.

### 2.3 `npm start`

```
ARRT name search combinations
{
  "totalCombinations": 4,
  "combinations": [
    { "firstName": "Chris", "lastName": "Adams" },
    { "firstName": "Chris", "lastName": "Anderson" },
    { "firstName": "Christian", "lastName": "Adams" },
    { "firstName": "Christian", "lastName": "Anderson" }
  ]
}
Alphabetical patterns (26): A*, B*, C*, ..., Z*
```

Matches the Step 1 specification exactly.

### 2.4 Syntax checks

`node --check` passed for every `backend/src/**/*.js` file. No parse errors.

### 2.5 Manual behavior probes (beyond the test suite)

| Probe | Observed result | Assessment |
| --- | --- | --- |
| `validateName('*', { allowWildcards: false })` | 3 errors: `WILDCARD_NOT_ALLOWED`, `INVALID_CHARACTERS`, `REQUIRES_LETTER` | Works, but noisy/overlapping |
| `validateName('Ch*ris')` | valid | Mid-pattern wildcard allowed (docs imply prefix use) |
| `generateCombinations({...}, null)` | raw `TypeError: Cannot read properties of null (reading 'sort')` | Unfriendly options handling |
| `generateAlphabetPatterns(null)` | raw `TypeError: Cannot read properties of null (reading 'characters')` | Unfriendly options handling |
| Non-string name entry | `NameValidationError` with clear list error | Good |
| `toNameList('Doe, John')` | `['Doe', 'John']` | Dangerous if reused for "Last, First" records |
| `dedupeNames(['Jose', 'José'])` | both kept | No diacritic folding policy |
| 500 × 500 valid names | 250,000 pairs in **297 ms**, **+42.3 MB** heap | No combination-count cap |
| ReDoS probe: `'a*'.repeat(8) + 'b'` vs 22 chars | 7.35 ms | Super-linear |
| ReDoS probe: 10 groups vs 26 chars | 125.88 ms | Super-linear |
| ReDoS probe: 12 groups vs 30 chars | **2,185.38 ms** | Confirmed catastrophic backtracking |

Probe scripts were created outside the repository; no project file was changed.

---

## 3. Bugs and Potential Issues

### P1 — Wildcard matching is vulnerable to catastrophic backtracking (Medium now, High once exposed)

`wildcard.util.js:62-74` converts every `*` segment to `.*` and anchors the
pattern. Repeated non-adjacent wildcards (`a*a*a*…b`) become adjacent
`.*` groups, which backtrack exponentially on a failing match. This was
confirmed: 12 groups against 30 characters took ~2.19 s; 16 groups against a
50-character string would be far worse.

Current inputs are capped at 50 characters and used locally, so the immediate
exposure is limited. However:

- validation does not limit wildcard count/complexity (`name.validator.js:55-141`);
- the future API/dashboard may accept patterns from untrusted users;
- Step 2 may match patterns against longer extracted text.

Recommendation: add a wildcard-complexity guard, and/or replace regex matching
with a linear-time two-pointer wildcard matcher. Keep regex only where
backtracking cannot occur. Collapse redundant wildcard runs (currently only
adjacent `**` are collapsed).

### P2 — No cap on generated combinations (Medium for future use)

`name-generator.service.js:71-100` materializes the full cartesian product.
A 500 × 500 input created 250,000 objects and ~42 MB; 2,000 × 2,000 would
exhaust memory. `generateAlphabetPatterns` has `maxPatterns`, but
`generateCombinations` has no equivalent.

Recommendation: `maxCombinations` option (default e.g. 10,000) or a generator/
paged API that yields batches.

### P3 — Null/invalid options produce raw TypeErrors (Low)

Default parameters only cover `undefined`, so `generateCombinations(input, null)`
and `generateAlphabetPatterns(null)` throw implementation-detail messages
instead of a deliberate validation error. Normalize with `options ?? {}` and
validate option types.

### P4 — Overlapping validation errors (Low)

With `allowWildcards: false`, `'*'` yields three errors. This is not incorrect,
but API consumers must pick a primary error. Short-circuit or prioritize one
error per value.

### P5 — Existing name validation cannot represent common record formats (Medium for Step 2)

The validator rejects commas and suffix punctuation beyond periods
(e.g. `"Smith, John Jr."`), and `toNameList` splits on commas. ARRT result
tables and extracted names may use `"Last, First"` or suffix forms. Step 2 must
not feed raw table text directly into `validateName`/`toNameList`; it needs a
dedicated cleanup/parse step before storing the display name or deriving
first/last names.

### P6 — Dedupe policy for diacritics is undefined (Info)

`"Jose"` and `"José"` are treated as distinct. That may be correct, but the
policy should be explicit for extracted records and DB uniqueness keys.

### P7 — Mixed literal/wildcard entries are not labeled (Info)

`generateCombinations` passes `"A*"` through like a literal name. This is safe
because `*` is invalid in literal names, but consumers must call
`hasWildcard()` to distinguish. Consider adding metadata in Step 2/3 rather
than changing the Step 1 output contract.

### P8 — README wording ambiguity (Info)

`README.md:68` says "at most one meaningful wildcard form", while the validator
actually allows multiple wildcards anywhere as long as a non-wildcard character
exists and the value is ≤50 chars. The rule should be stated precisely or
enforced as intended.

### P9 — Test-suite gaps (Info)

Current coverage misses the edge cases above: null options, options type
errors, non-array inputs to `findMatchingNames`, case-sensitive matching,
`REQUIRES_LETTER`, duplicate-prefix behavior, combination caps, and bounded
performance tests. The test script names a single file, so Step 2 tests require
a script update to `node --test src/tests`.

### P10 — Minor code hygiene (Info)

- `buildListError` is used for single values (`name.validator.js:254-265`);
  cosmetic naming only.
- `index.js` demo is the only uncovered file region; acceptable.
- No linter/formatter/CI configuration. Not a functional bug.

No functional defect was found in the required Step 1 behaviors.

---

## 4. Missing Functionality Against the Overall Project

| Overall requirement | Status | Notes |
| --- | --- | --- |
| 1. Use ARRT as intended data source | **Not started** | Intentionally out of scope for Step 1; no network code exists |
| 2. Collect ~300–350 authorized sample records | **Not started** | No collection or fixture dataset yet |
| 3. Extract name, city, state, credential string | **Not started** | Phase 1 only prepares search names |
| 4. Normalize/validate extracted info with JS + Regex | **Partially reusable** | Name normalizer/validator can be reused with a new non-wildcard path; city/state/credential validators do not exist |
| 5. Store records in PostgreSQL | **Not started** | No DB driver, schema, migrations or repository layer |
| 6. Express REST APIs | **Not started** | No server, routes, query validation, pagination contract |
| 7. Next.js dashboard (search/filter/sort/pagination) | **Not started** | No `frontend/` or API client |
| Cross-cutting: config/env management | **Not started** | No `.env` conventions or config module |
| Cross-cutting: logging/observability | **Not started** | Only console output in demo |
| Cross-cutting: error taxonomy for extraction | **Not started** | Only name validation errors exist |
| Cross-cutting: CI/CD, lint/format | **Not started** | Tests run manually; repo is not under git |
| Cross-cutting: compliance/provenance | **Not started** | No record source/license/collection metadata model |

### Capability gaps relevant to Step 2

- No HTML parsing/fixture machinery.
- No US state validation or canonicalization.
- No credential-string format definition. **Do not guess it from the live site**;
  derive a bounded regex only from the authorized sample data.
- No record-level missing-field/rejection reporting.
- No cross-page dedupe strategy.
- No extraction provenance model (`page`, `row`, `fixture`, timestamp).
- No generic field validator (current validator is name/wildcard-oriented).

---

## 5. Recommended Improvements Before/Alongside Step 2

Priority order:

1. **Harden wildcards** (P1): cap wildcard runs, reject pathological patterns
   (`a*a*a*a*…`), and use a linear matcher for non-prefix cases. Add a bounded
   performance test.
2. **Add combination limits** (P2): `maxCombinations`, with a clear error
   message; consider a batched iterator later.
3. **Normalize options** (P3): treat `null` as `{}` and validate option types.
4. **Introduce extraction-safe name handling** (P5): dedicated
   `cleanDisplayName`, `splitName`/suffix policy, and `validateName(...,
   { allowWildcards: false })` for stored records. Do not reuse comma splitting
   for `"Last, First"`.
5. **Clarify dedupe policy** (P6): decide diacritic folding and document it in
   the DB uniqueness key.
6. **Add missing tests and coverage script** (P9); update `npm test` to run all
   test files.
7. **Document wildcard positioning** (P8) or restrict wildcards to the trailing
   edge if only prefix generation is required.
8. Optional, later: lint/format (Prettier/ESLint), CI, git initialization,
   structured logging with PII redaction.

These are surgical changes to Step 1. They should be approved separately from
Step 2 so the audit remains a read-only baseline.

---

## 6. Proposed Step 2 Architecture — Data Extraction Engine

### 6.1 Scope constraints

- Input is **authorized, locally saved or synthetic HTML** representing ARRT
  result pages. No live ARRT access, no browser automation, no CAPTCHA handling,
  no pagination crawling.
- "Multiple pages" means an ordered array of provided page documents/fixtures
  (page 1..N), not network navigation.
- Only synthetic HTML fixtures are committed. No real PII.
- One HTML parser dependency is justified; nothing else is needed for Step 2.

### 6.2 Parser choice

Recommend **`node-html-parser`** as the single runtime dependency:

- DOM-like tree with `querySelectorAll`, no browser/DOM emulation.
- Smaller footprint than `cheerio`/`jsdom`; fast for 300–350 records.
- Sufficient for table/row/cell traversal.

Alternative: `cheerio` if richer selector/traversal ergonomics are preferred.
This is an approval checkpoint. No dependency is installed by this audit.

### 6.3 Pipeline

```
page sources (HTML strings/files)
        │
        ▼
[1] source loader ── size/page limits, provenance metadata
        ▼
[2] DOM parser ───── parse once, no script execution, no external fetches
        ▼
[3] table locator ── find results table by headers/semantic cues
        ▼
[4] header mapper ── label → column index map (never hardcode positions)
        ▼
[5] row extractor ── tbody rows, DOM text, skip blank/malformed
        ▼
[6] field cleaner ── HTML entities, NBSP, whitespace, placeholders
        ▼
[7] field validators ── name/city/state/credential regexes + normalization
        ▼
[8] record builder ── fields + fieldStatus + warnings + provenance
        ▼
[9] deduplicator ─── credential key fallback name|city|state, across pages
        ▼
[10] aggregator ───── per-page stats, accepted/rejected, deterministic order
        ▼
structured extraction result
```

### 6.4 Contract proposal

Accepted record:

```json
{
  "name": "Jane A. Doe",
  "city": "Minneapolis",
  "state": "MN",
  "credential": "SAMPLE-000123",
  "fieldStatus": { "name": "present", "city": "present", "state": "present", "credential": "present" },
  "source": { "fixture": "results-page-1.html", "page": 1, "row": 4 },
  "extractedAt": "2026-11-17T00:00:00.000Z",
  "warnings": []
}
```

Aggregate result:

```json
{
  "pagesProcessed": 2,
  "totalRows": 24,
  "totalAccepted": 20,
  "totalRejected": 2,
  "totalDuplicates": 2,
  "records": [],
  "rejected": [
    {
      "row": 7,
      "page": 2,
      "raw": { "name": "...", "city": "...", "state": "...", "credential": "..." },
      "code": "INVALID_STATE",
      "message": "State must be a valid two-letter USPS code."
    }
  ]
}
```

Rejected rows are surfaced, never silently dropped. `strict` mode can promote
missing optional fields to rejection; default collects partial records with
warnings for later review.

### 6.5 Field rules

| Field | Normalization | Validation |
| --- | --- | --- |
| Name | DOM text, entity decode, whitespace collapse; handle suffix/comma policy before `validateName` | Reuse `normalizeName`; validator with `allowWildcards: false`, max configurable (e.g. 80); reject markup/control chars |
| City | Whitespace/entity normalize, preserve casing | Letters, spaces, periods, hyphens, apostrophes; max ~80; at least one letter |
| State | Trim, uppercase; map full state name → USPS code | Must be in a fixed 50-state + DC/territory set; otherwise `INVALID_STATE` |
| Credential | Trim, collapse internal spaces, preserve leading zeros | Anchored regex defined **from authorized fixture format**, bounded quantifiers, max length; no unbounded `.*`; exact pattern TBD with sample data |

All regexes: anchored, no nested quantifiers, length-capped. Extracted text is
never compiled into a RegExp.

### 6.6 Missing fields and malformed rows

- Detect empty cells, `N/A`, `-`, `—`, `null`, whitespace-only.
- Track per-field status: `present`, `missing`, `invalid`.
- `colspan`/`rowspan` mismatch, unexpected cell count, or missing required
  headers → row/page-level error with fixture/page/row context.
- Per-page failure isolation: one bad page does not abort aggregation; the
  aggregate reports it and continues, configurable via `failFast`.

### 6.7 Duplicate detection

- Primary key: normalized credential when present and valid.
- Fallback key: `toNameKey(name) | city.toLowerCase() | state`.
- Dedupe in a `Map` across all pages; keep first occurrence and record its
  provenance; count duplicates; optionally return duplicate details for audit.
- Policy must be documented because two different people can share a name/city;
  credential is always preferred.

### 6.8 Multi-page aggregation

- Input: `[{ id, html, pageNumber, fixture }]` (ordered).
- Output ordering: page order, then row order.
- Stats: rows, accepted, rejected, duplicates per page and overall.
- No navigation, no URL fetching, no pagination discovery. If pagination HTML
  exists, only parse explicit links as metadata, never follow them.

### 6.9 Unit tests with local fixtures

Fixture set (synthetic only):

| Fixture | Purpose |
| --- | --- |
| `results-page-1.html` | Happy path, 10–15 rows |
| `results-page-2.html` | Second page with overlap for cross-page dedupe |
| `results-reordered.html` | Headers in different order |
| `results-missing.html` | Missing city/state/credential, placeholders |
| `results-invalid.html` | Invalid state, bad credential, markup injection text |
| `results-malformed.html` | Short rows, colspan, extra cells |
| `results-empty.html` | "No results" table/message |
| `results-header-missing.html` | Wrong/missing headers |

Test cases:

1. Happy-path extraction of all four fields.
2. Column mapping by header, not position.
3. Whitespace, NBSP and HTML entity normalization.
4. Missing-field warnings and strict-mode rejection.
5. Invalid characters/state/credential produce row errors, not crashes.
6. Duplicate within a page and across pages.
7. Multi-page aggregation order and stats.
8. Empty/no-results page.
9. Malformed row handling.
10. Deterministic output and JSON serialization.
11. Regex safety/performance bounds for field validators.
12. Optional: header labels with differing case/extra spaces.

All tests inject HTML strings or read fixtures from disk; no HTTP.

### 6.10 Security and compliance

- Treat HTML as untrusted: no script eval, no resource loading, input size cap.
- Never log full PII in production; log counts, row indexes and error codes.
- Keep raw HTML out of PostgreSQL; store only extracted records + provenance.
- Collection must be explicitly authorized; this phase uses synthetic fixtures.
- No CAPTCHA bypass, no stealth/browser automation in this phase.

### 6.11 Future phases (not implemented now)

- **PostgreSQL:** `credential_records` with full name (and optional parsed
  first/last), city, state `char(2)`, credential, source metadata, timestamps;
  unique credential index, search indexes (`lower(name)`, state, city); SQL
  migrations + parameterized queries.
- **Express:** `GET /api/records` with `search`, `state`, `city`, `sort`,
  `page`, `pageSize`; validated query params; pagination metadata; consistent
  error envelope.
- **Next.js:** App Router dashboard, URL-driven search/filter/sort/pagination,
  accessible table, loading/error/empty states.

---

## 7. Files to Create or Modify in Step 2

### Create

| File | Purpose |
| --- | --- |
| `backend/src/extraction/html-loader.js` | Accept HTML strings/fixture paths, enforce size/page limits, attach provenance |
| `backend/src/extraction/table-extractor.js` | Locate result tables, map headers, iterate rows/cells |
| `backend/src/extraction/record-mapper.js` | Map raw cells to candidate records; placeholders/empty handling |
| `backend/src/extraction/field-validators.js` | City/state/credential validation + safe regexes; name bridge |
| `backend/src/extraction/deduplicator.js` | Cross-page dedupe with credential-first key and provenance |
| `backend/src/extraction/extraction.service.js` | Orchestrate pages → accepted/rejected/stats |
| `backend/src/extraction/errors.js` | `ExtractionError` codes (`TABLE_NOT_FOUND`, `HEADER_MISMATCH`, `MALFORMED_ROW`, `MISSING_FIELD`, `INVALID_FIELD`, `DUPLICATE_RECORD`) |
| `backend/src/extraction/index.js` | Extraction barrel (optional if `src/index.js` re-exports) |
| `backend/src/tests/extraction.test.js` | Unit/integration tests over fixtures |
| `backend/src/tests/fixtures/*.html` | 5–8 synthetic fixture pages (see §6.9) |
| `backend/src/tests/fixtures/README.md` | Fixture provenance: synthetic, no real PII |
| `docs/step-2-extraction.md` | Extraction contract, field rules, fixture policy |

### Modify

| File | Change |
| --- | --- |
| `backend/package.json` | Add `node-html-parser`; change `test` script to run all test files (e.g. `node --test src/tests`); add extraction demo script if useful |
| `backend/src/index.js` | Export extraction API after implementation |
| `backend/README.md` | Document Step 2 usage, fixture workflow, extraction contract |

### Explicitly unchanged in Step 2

- Existing Step 1 modules and tests. Field validators stay in `extraction/` to
  avoid coupling name-search logic to record ingestion.
- No DB, Express, Next.js, browser automation or CAPTCHA code.

### Optional Step 1 hardening (separate approval)

| File | Change |
| --- | --- |
| `backend/src/utils/wildcard.util.js` | Wildcard-complexity guard / linear matcher |
| `backend/src/services/name-generator.service.js` | `maxCombinations`, option normalization |
| `backend/src/validators/name.validator.js` | Error prioritization if desired |
| `backend/src/tests/name-generator.test.js` | Add regression/perf tests |

---

## 8. Audit Verdict

Step 1 is functionally complete and matches its specification: all required
features exist, 22/22 tests pass, coverage is high, the demo output is correct,
and there are zero dependencies. No blocking Step 1 bug was found.

The two issues to address before broader exposure are wildcard backtracking
(P1) and the missing combination cap (P2). For Step 2, the main design gap is
that the current name parser/validator is tuned for search input, not for
extracting display names from result tables (P5); Step 2 should add a separate
extraction-safe field layer rather than changing Step 1 semantics.

**Approval requested before any code changes:**

1. Accept the audit findings and baseline.
2. Choose `node-html-parser` (recommended) or `cheerio`.
3. Confirm the synthetic fixture/credential-format approach (format finalized
   only from authorized sample data).
4. Decide whether to apply Step 1 hardening (P1/P2/P3) before Step 2 or defer it.

---

## 9. Post-Audit Hardening Status (applied)

The audit findings were approved, and the following hardening was implemented
before Step 2:

| Finding | Resolution | Regression tests |
| --- | --- | --- |
| P1 wildcard ReDoS | `matchesWildcard`/`findMatchingNames` use a bounded two-pointer matcher. Patterns are capped at 100 chars and 8 wildcards. `wildcardToRegExp` is capped at 4 wildcards for compatibility. | Pathological `a*a*…b` patterns complete in milliseconds; complex valid matches still work. |
| P2 combination cap | `generateCombinations` accepts `maxCombinations` (default 10,000) and throws `TOO_MANY_COMBINATIONS` with requested/actual counts. | Cap exceeded, exact cap, and `Infinity` cases. |
| P3 options handling | `undefined` means defaults; `null`, arrays, unknown keys and invalid values throw descriptive `INVALID_OPTIONS` errors. | `null` options, non-objects, unknown keys, invalid booleans/integers. |
| P4 overlapping errors | Wildcards are removed from character checks; errors short-circuit to a primary cause. | `*` with wildcards disabled returns only `WILDCARD_NOT_ALLOWED`; punctuation-only and invalid-digit cases. |
| P5 record names | Kept separate: Step 2 has its own display-name validator/normalizer that accepts commas/suffixes. Step 1 semantics are unchanged. | Covered by Step 2 extraction tests. |

Verification after hardening: **34/34 Step 1 tests pass** (22 original + 12 new).

The Step 1 output contract remains unchanged:
`{ totalCombinations, combinations: [{ firstName, lastName }] }`.

