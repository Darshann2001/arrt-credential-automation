'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  COMPOSITE_STRATEGY,
  EXTRACTION_CODES,
  ExtractionError,
  RECORD_ID_STRATEGY,
  buildDedupeKey,
  buildStatistics,
  createDuplicateTracker,
  extractRecords,
  extractRows,
  isRecognizedState,
  loadPage,
  loadPages,
  locateResultsTable,
  mapHeaders,
  normalizeCity,
  normalizeCredentialString,
  normalizeFullName,
  normalizeRecordValues,
  normalizeState,
  parseHtml,
  validateCity,
  validateCredentialString,
  validateFullName,
  validateRecordValues,
  validateState,
} = require('../index');

const FIXTURE_DIR = path.join(__dirname, '..', 'extraction', 'fixtures');

function fixture(name) {
  return path.join(FIXTURE_DIR, name);
}

function readFixture(name) {
  return loadPage(fixture(name));
}

function assertConsistentCounts(result) {
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

// ---------------------------------------------------------------------------
// HTML loader
// ---------------------------------------------------------------------------

test('HTML loader reads fixture files, inline HTML and page metadata', () => {
  const loaded = readFixture('normal.html');
  assert.equal(loaded.fixture, 'normal.html');
  assert.equal(loaded.page, 1);
  assert.match(loaded.html, /Alice\s+Smith/);

  const inline = loadPage({
    html: '<table><tr><td>inline</td></tr></table>',
    page: 3,
    fixture: 'inline-case',
    sourceUrl: 'local://inline-case',
  });
  assert.equal(inline.page, 3);
  assert.equal(inline.fixture, 'inline-case');
  assert.equal(inline.sourceUrl, 'local://inline-case');

  const pages = loadPages([
    { html: '<p>one</p>', page: 1 },
    { html: '<p>two</p>', page: 2 },
  ]);
  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((page) => page.page),
    [1, 2]
  );
});

test('HTML loader rejects remote URLs, missing sources and oversized pages', () => {
  assert.throws(
    () => loadPage('https://example.com/results'),
    (error) =>
      error instanceof ExtractionError &&
      error.code === EXTRACTION_CODES.UNSUPPORTED_SOURCE
  );

  assert.throws(
    () => loadPage({ sourceUrl: 'https://example.com/results', page: 1 }),
    (error) => error.code === EXTRACTION_CODES.UNSUPPORTED_SOURCE
  );

  assert.throws(
    () => loadPages([]),
    (error) => error.code === EXTRACTION_CODES.NO_PAGES
  );

  assert.throws(
    () => loadPage({ html: '   ', page: 1 }),
    (error) => error.code === EXTRACTION_CODES.EMPTY_HTML
  );

  assert.throws(
    () => loadPage({ html: '<p>too big</p>' }, { maxBytes: 1 }),
    (error) => error.code === EXTRACTION_CODES.HTML_TOO_LARGE
  );

  assert.throws(
    () => loadPage({ fixturePath: fixture('does-not-exist.html') }),
    (error) => error.code === EXTRACTION_CODES.INVALID_PAGE_SOURCE
  );
});

// ---------------------------------------------------------------------------
// DOM parser
// ---------------------------------------------------------------------------

test('DOM parser recovers from malformed HTML and rejects empty documents', () => {
  const $ = parseHtml(
    '<table><tr><th>Name<th>City<tr><td>Alice<td>Springfield</table>'
  );

  assert.equal($('th').length, 2);
  assert.equal($('td').length, 2);

  assert.throws(
    () => parseHtml('   '),
    (error) => error.code === EXTRACTION_CODES.EMPTY_HTML
  );
});

// ---------------------------------------------------------------------------
// Header mapping and table location
// ---------------------------------------------------------------------------

test('header mapper identifies reordered columns by label', () => {
  const mapping = mapHeaders(['Credential', 'State', 'Name', 'City']);

  assert.deepEqual(mapping.columns, {
    credentialString: 0,
    state: 1,
    fullName: 2,
    city: 3,
  });
  assert.deepEqual(mapping.missing, []);
  assert.deepEqual(mapping.duplicateHeaders, []);
});

test('header mapper supports aliases, missing headers and duplicate headers', () => {
  const aliased = mapHeaders([
    'Record ID',
    'Full Name',
    'Town',
    'State or Province',
    'License Number',
  ]);
  assert.deepEqual(aliased.columns, {
    recordId: 0,
    fullName: 1,
    city: 2,
    state: 3,
    credentialString: 4,
  });

  const missingAndDuplicate = mapHeaders(['Name', 'Name', 'City', 'State']);
  assert.equal(missingAndDuplicate.columns.fullName, 0);
  assert.deepEqual(missingAndDuplicate.missing, ['credentialString']);
  assert.equal(missingAndDuplicate.duplicateHeaders.length, 1);
  assert.deepEqual(missingAndDuplicate.duplicateHeaders[0], {
    field: 'fullName',
    firstIndex: 0,
    duplicateIndex: 1,
    label: 'Name',
  });
});

test('table locator selects the results table instead of navigation tables', () => {
  const $ = parseHtml(readFixture('multiple-tables.html').html);
  const info = locateResultsTable($, { requiredFields: ['fullName'] });

  assert.equal(info.tableIndex, 1);
  assert.deepEqual(info.headerLabels, ['Name', 'City', 'State', 'Credential']);
  assert.deepEqual(info.columns, {
    fullName: 0,
    city: 1,
    state: 2,
    credentialString: 3,
  });
});

test('table locator reports missing tables and mismatched headers', () => {
  const noTable = parseHtml(readFixture('no-table.html').html);
  assert.throws(
    () => locateResultsTable(noTable, { requiredFields: ['fullName'] }),
    (error) => error.code === EXTRACTION_CODES.TABLE_NOT_FOUND
  );

  const mismatched = parseHtml(readFixture('mismatched-headers.html').html);
  assert.throws(
    () => locateResultsTable(mismatched, { requiredFields: ['fullName'] }),
    (error) => error.code === EXTRACTION_CODES.HEADER_MISMATCH
  );

  const missingColumn = parseHtml(readFixture('missing-column.html').html);
  assert.throws(
    () =>
      locateResultsTable(missingColumn, {
        requiredFields: ['fullName', 'city'],
      }),
    (error) =>
      error.code === EXTRACTION_CODES.HEADER_MISMATCH &&
      error.details.missing.includes('city')
  );
});

test('row extractor expands colspan, skips repeated headers and keeps provenance', () => {
  const $ = parseHtml(`
    <table>
      <tr><th>Name</th><th>City</th><th>State</th><th>Credential</th></tr>
      <tr><td colspan="2">Spanning Person</td><td>IL</td><td>TEST-9001</td></tr>
      <tr><th>Name</th><th>City</th><th>State</th><th>Credential</th></tr>
      <tr><td>Second Person</td><td>Chicago</td><td>IL</td><td>TEST-9002</td></tr>
    </table>
  `);
  const tableInfo = locateResultsTable($, { requiredFields: ['fullName'] });
  const { rows, ignored } = extractRows($, tableInfo, {
    page: 9,
    fixture: 'inline-row-test.html',
  });

  assert.equal(rows.length, 2);
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].reason, 'repeated-header');
  assert.equal(rows[0].values.fullName, 'Spanning Person');
  assert.equal(rows[0].values.city, '');
  assert.equal(rows[0].values.state, 'IL');
  assert.equal(rows[0].provenance.page, 9);
  assert.equal(rows[0].provenance.rowNumber, 1);
  assert.equal(rows[0].provenance.sourceRowIndex, 2);
  assert.equal(rows[1].values.fullName, 'Second Person');
  assert.equal(rows[1].provenance.rowNumber, 3);
});

// ---------------------------------------------------------------------------
// Normalization and validation
// ---------------------------------------------------------------------------

test('field normalizers collapse whitespace and map recognized states', () => {
  assert.equal(normalizeFullName('  Smith ,  John   Jr. '), 'Smith, John Jr.');
  assert.equal(normalizeCity('  San   Jose '), 'San Jose');
  assert.equal(normalizeState('Illinois'), 'IL');
  assert.equal(normalizeState('n.y.'), 'NY');
  assert.equal(normalizeState('Ontario'), 'Ontario');
  assert.equal(normalizeCredentialString(' TEST-0001 '), 'TEST-0001');

  const normalized = normalizeRecordValues({
    fullName: ' Smith , John ',
    city: ' New   York ',
    state: 'new york',
    credentialString: ' TEST-1 ',
  });
  assert.deepEqual(normalized, {
    fullName: 'Smith, John',
    city: 'New York',
    state: 'NY',
    credentialString: 'TEST-1',
    recordId: '',
  });
});

test('validators report missing fields and preserve unfamiliar state values', () => {
  const missing = validateRecordValues({
    fullName: '',
    city: '',
    state: '',
    credentialString: '',
  });
  assert.deepEqual(
    missing.map((error) => error.code),
    [
      'MISSING_FULL_NAME',
      'MISSING_CITY',
      'MISSING_STATE',
      'MISSING_CREDENTIAL',
    ]
  );

  const invalidState = validateState('Ontario');
  assert.equal(invalidState.length, 1);
  assert.equal(invalidState[0].code, 'INVALID_STATE');
  assert.equal(invalidState[0].value, 'Ontario');
  assert.equal(isRecognizedState('Ontario'), false);
  assert.equal(isRecognizedState('IL'), true);
  assert.equal(isRecognizedState('Illinois'), true);

  assert.deepEqual(validateFullName('Name 123'), [
    {
      code: 'INVALID_FULL_NAME',
      field: 'fullName',
      message:
        'fullName must contain at least one letter and may only contain letters, spaces, periods, apostrophes, hyphens and commas.',
      value: 'Name 123',
    },
  ]);
  assert.equal(validateCity('123')[0].code, 'INVALID_CITY');
  assert.equal(validateCredentialString('')[0].code, 'MISSING_CREDENTIAL');
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

test('dedupe prefers a source record ID and falls back to a composite key', () => {
  const base = {
    fullName: 'Alice Smith',
    city: 'Springfield',
    state: 'IL',
    credentialString: 'TEST-0001',
  };

  const byId = buildDedupeKey({ ...base, recordId: ' R-1 ' });
  assert.equal(byId.strategy, RECORD_ID_STRATEGY);
  assert.equal(byId.key, 'record-id:r-1');

  const composite = buildDedupeKey(base);
  assert.equal(composite.strategy, COMPOSITE_STRATEGY);
  assert.match(composite.key, /^composite:alice smith\u0000springfield\u0000IL\u0000test-0001$/);

  const tracker = createDuplicateTracker();
  assert.equal(tracker.check(base).duplicate, false);
  assert.equal(
    tracker.check({
      ...base,
      fullName: '  ALICE   SMITH ',
      city: ' springfield ',
      credentialString: ' test-0001 ',
    }).duplicate,
    true
  );

  const result = tracker.check({ ...base, credentialString: 'TEST-9999' });
  assert.equal(result.duplicate, false);
  assert.equal(tracker.size(), 2);
});

// ---------------------------------------------------------------------------
// Service: normal and reordered fixtures
// ---------------------------------------------------------------------------

test('extractRecords returns the documented output shape for a normal table', () => {
  const result = extractRecords(fixture('normal.html'));

  assert.deepEqual(Object.keys(result).sort(), [
    'acceptedCount',
    'duplicateCount',
    'records',
    'rejectedCount',
    'rejectedRows',
    'stats',
    'totalRows',
  ]);
  assert.deepEqual(
    {
      totalRows: result.totalRows,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      duplicateCount: result.duplicateCount,
    },
    {
      totalRows: 4,
      acceptedCount: 4,
      rejectedCount: 0,
      duplicateCount: 0,
    }
  );
  assertConsistentCounts(result);

  assert.deepEqual(result.records[0], {
    fullName: 'Alice Smith',
    city: 'Springfield',
    state: 'IL',
    credentialString: 'TEST-0001',
    recordId: null,
    source: {
      page: 1,
      fixture: 'normal.html',
      sourceUrl: null,
      rowNumber: 1,
      sourceRowIndex: 2,
    },
  });
  assert.equal(result.records[1].fullName, "Bob O'Neil");
  assert.equal(result.records[2].fullName, 'Carol de la Cruz');
  assert.equal(result.records[2].city, 'San Jose');
  assert.equal(result.records[3].fullName, 'Smith, John Jr.');
  assert.equal(result.records[3].state, 'NY');
  assert.equal(result.stats.pagesProcessed, 1);
});

test('extractRecords supports reordered columns', () => {
  const result = extractRecords(fixture('reordered-columns.html'));

  assertConsistentCounts(result);
  assert.equal(result.acceptedCount, 2);
  assert.deepEqual(
    result.stats.pages[0].columns,
    {
      credentialString: 0,
      state: 1,
      fullName: 2,
      city: 3,
    }
  );
  assert.deepEqual(
    result.records.map((record) => ({
      fullName: record.fullName,
      city: record.city,
      state: record.state,
      credentialString: record.credentialString,
    })),
    [
      {
        fullName: 'Dana White',
        city: 'Austin',
        state: 'TX',
        credentialString: 'TEST-1001',
      },
      {
        fullName: 'Evan Black',
        city: 'Miami',
        state: 'FL',
        credentialString: 'TEST-1002',
      },
    ]
  );
});

// ---------------------------------------------------------------------------
// Service: missing data
// ---------------------------------------------------------------------------

test('extractRecords rejects rows with missing city or state and keeps diagnostics', () => {
  const result = extractRecords(fixture('missing-fields.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 3);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 2);
  assert.deepEqual(result.stats.primaryErrorsByCode, {
    MISSING_CITY: 1,
    MISSING_STATE: 1,
  });

  assert.equal(result.rejectedRows[0].code, 'MISSING_CITY');
  assert.equal(result.rejectedRows[0].values.fullName, 'Missing City Person');
  assert.equal(result.rejectedRows[0].source.page, 1);
  assert.equal(result.rejectedRows[0].source.rowNumber, 1);
  assert.equal(result.rejectedRows[1].code, 'MISSING_STATE');
  assert.equal(result.rejectedRows[1].values.city, 'Chicago');
  assert.equal(result.records[0].fullName, 'Valid Person');
  assert.equal(result.records[0].source.rowNumber, 3);
});

test('extractRecords rejects rows with missing credentials', () => {
  const result = extractRecords(fixture('missing-credentials.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 2);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.rejectedRows[0].code, 'MISSING_CREDENTIAL');
  assert.equal(result.rejectedRows[0].values.fullName, 'No Credential Person');
  assert.equal(result.records[0].credentialString, 'TEST-3001');
});

test('extractRecords rejects a missing column as a row-level field error', () => {
  const result = extractRecords(fixture('missing-column.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 1);
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.rejectedRows[0].code, 'MISSING_CITY');
  assert.equal(result.rejectedRows[0].rawValues.city, null);

  assert.throws(
    () =>
      extractRecords(fixture('missing-column.html'), {
        requiredHeaders: ['fullName', 'city'],
      }),
    (error) =>
      error.code === EXTRACTION_CODES.HEADER_MISMATCH &&
      error.details.missing.includes('city')
  );
});

test('extractRecords preserves unfamiliar state values on rejected rows', () => {
  const result = extractRecords(fixture('unfamiliar-state.html'));

  assertConsistentCounts(result);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.rejectedRows[0].code, 'INVALID_STATE');
  assert.equal(result.rejectedRows[0].values.state, 'Ontario');
  assert.equal(result.rejectedRows[0].rawValues.state, 'Ontario');
  assert.equal(result.stats.allErrorsByCode.INVALID_STATE, 1);
});

// ---------------------------------------------------------------------------
// Service: duplicates and multiple pages
// ---------------------------------------------------------------------------

test('extractRecords detects duplicate rows with the documented composite key', () => {
  const result = extractRecords(fixture('duplicates.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 4);
  assert.equal(result.acceptedCount, 3);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.stats.duplicateStrategies[COMPOSITE_STRATEGY], 1);
  assert.equal(result.stats.duplicates[0].fullName, 'Alice Smith');
  assert.equal(result.stats.duplicates[0].duplicateOf.page, 1);
  assert.equal(result.stats.duplicates[0].duplicateOf.rowNumber, 1);
  assert.equal(result.records[1].credentialString, 'TEST-9999');
});

test('extractRecords deduplicates across pages', () => {
  const result = extractRecords([
    { fixturePath: fixture('page-1.html'), page: 1 },
    { fixturePath: fixture('page-2.html'), page: 2 },
  ]);

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 4);
  assert.equal(result.acceptedCount, 3);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.stats.pagesProcessed, 2);
  assert.deepEqual(
    result.records.map((record) => record.fullName),
    ['Cross Page Person', 'First Page Only', 'Second Page Only']
  );
  assert.equal(result.stats.duplicates[0].page, 2);
  assert.equal(result.stats.duplicates[0].duplicateOf.page, 1);
  assert.equal(result.stats.duplicates[0].duplicateOf.rowNumber, 1);
});

test('extractRecords prefers a source record ID for deduplication', () => {
  const result = extractRecords(fixture('record-ids.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 3);
  assert.equal(result.acceptedCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.stats.duplicateStrategies[RECORD_ID_STRATEGY], 1);
  assert.equal(result.stats.duplicates[0].recordId, 'R-1');
  assert.equal(result.stats.duplicates[0].fullName, 'Alice Smith Changed');
  assert.equal(result.stats.duplicates[0].duplicateOf.recordId, 'R-1');
  assert.deepEqual(
    result.records.map((record) => record.recordId),
    ['R-1', 'R-2']
  );
});

test('dedupe can be disabled explicitly', () => {
  const result = extractRecords(fixture('duplicates.html'), { dedupe: false });

  assertConsistentCounts(result);
  assert.equal(result.acceptedCount, 4);
  assert.equal(result.duplicateCount, 0);
});

// ---------------------------------------------------------------------------
// Service: empty, malformed and wrong tables
// ---------------------------------------------------------------------------

test('extractRecords returns zero counts for an empty results table', () => {
  const result = extractRecords(fixture('empty-results.html'));

  assertConsistentCounts(result);
  assert.deepEqual(
    {
      totalRows: result.totalRows,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      duplicateCount: result.duplicateCount,
    },
    {
      totalRows: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
    }
  );
  assert.equal(result.stats.ignoredRowCount, 1);
  assert.equal(result.stats.ignoredRows[0].reason, 'no-results');
  assert.equal(result.stats.ignoredRows[0].text, 'No results found.');
});

test('extractRecords handles malformed HTML and keeps malformed rows', () => {
  const result = extractRecords(fixture('malformed.html'));

  assertConsistentCounts(result);
  assert.equal(result.totalRows, 3);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 2);
  assert.equal(result.records[0].fullName, 'Malformed But Valid');
  assert.equal(result.rejectedRows[0].code, 'MALFORMED_ROW');
  assert.equal(result.rejectedRows[0].source.rowNumber, 2);
  assert.equal(result.rejectedRows[1].code, 'MISSING_CITY');
  assert.deepEqual(
    result.rejectedRows[1].errors.map((error) => error.code),
    ['MISSING_CITY', 'MISSING_STATE', 'MISSING_CREDENTIAL']
  );
});

test('extractRecords locates the results table among unrelated tables', () => {
  const result = extractRecords(fixture('multiple-tables.html'));

  assertConsistentCounts(result);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.records[0].fullName, 'Correct Table Person');
  assert.equal(result.stats.pages[0].tableIndex, 1);
});

test('extractRecords honours tableSelector and reports header mismatches', () => {
  const result = extractRecords(fixture('multiple-tables.html'), {
    tableSelector: '#results',
  });
  assert.equal(result.acceptedCount, 1);

  assert.throws(
    () =>
      extractRecords(fixture('multiple-tables.html'), {
        tableSelector: '#navigation',
      }),
    (error) =>
      error.code === EXTRACTION_CODES.HEADER_MISMATCH &&
      error.page === 1 &&
      error.fixture === 'multiple-tables.html'
  );
});

test('extractRecords reports missing tables and mismatched headers', () => {
  assert.throws(
    () => extractRecords(fixture('no-table.html')),
    (error) =>
      error.code === EXTRACTION_CODES.TABLE_NOT_FOUND &&
      error.page === 1 &&
      error.fixture === 'no-table.html'
  );

  assert.throws(
    () => extractRecords(fixture('mismatched-headers.html')),
    (error) => error.code === EXTRACTION_CODES.HEADER_MISMATCH
  );
});

// ---------------------------------------------------------------------------
// Service: options, limits and statistics
// ---------------------------------------------------------------------------

test('extractRecords rejects invalid options deliberately', () => {
  assert.throws(
    () => extractRecords(fixture('normal.html'), null),
    (error) =>
      error.code === EXTRACTION_CODES.INVALID_OPTIONS &&
      /options must be a plain object, received null/i.test(error.message)
  );

  for (const options of [
    [],
    { unknownOption: true },
    { maxRows: 0 },
    { maxBytes: -1 },
    { dedupe: 'yes' },
    { noResultsPattern: 'none' },
    { requiredHeaders: [] },
    { requiredHeaders: ['notAField'] },
  ]) {
    assert.throws(
      () => extractRecords(fixture('normal.html'), options),
      (error) => error.code === EXTRACTION_CODES.INVALID_OPTIONS
    );
  }
});

test('extractRecords enforces maxRows and rejects remote sources', () => {
  assert.throws(
    () => extractRecords(fixture('normal.html'), { maxRows: 2 }),
    (error) =>
      error.code === EXTRACTION_CODES.ROW_LIMIT_EXCEEDED &&
      error.details.maxRows === 2
  );

  assert.throws(
    () => extractRecords('https://example.com/results'),
    (error) => error.code === EXTRACTION_CODES.UNSUPPORTED_SOURCE
  );
});

test('statistics keep accepted, rejected and duplicate counts consistent', () => {
  const stats = buildStatistics({
    pageReports: [{ page: 1 }],
    records: [{ source: { page: 1, rowNumber: 1 } }],
    rejectedRows: [
      {
        code: 'INVALID_STATE',
        errors: [
          { code: 'INVALID_STATE' },
          { code: 'MISSING_CITY' },
        ],
      },
    ],
    duplicates: [
      {
        key: 'composite:x',
        strategy: COMPOSITE_STRATEGY,
        record: {
          fullName: 'X',
          recordId: null,
          source: { page: 1, rowNumber: 3 },
        },
        duplicateOf: { page: 1, rowNumber: 1, recordId: null },
      },
    ],
    ignoredRows: [{ reason: 'no-results' }],
  });

  assert.equal(stats.totalRows, 3);
  assert.equal(stats.acceptedCount, 1);
  assert.equal(stats.rejectedCount, 1);
  assert.equal(stats.duplicateCount, 1);
  assert.equal(stats.countsConsistent, true);
  assert.equal(stats.acceptanceRate, 1 / 3);
  assert.equal(stats.rejectionRate, 1 / 3);
  assert.equal(stats.duplicateRate, 1 / 3);
  assert.deepEqual(stats.primaryErrorsByCode, { INVALID_STATE: 1 });
  assert.deepEqual(stats.allErrorsByCode, {
    INVALID_STATE: 1,
    MISSING_CITY: 1,
  });
  assert.deepEqual(stats.duplicateStrategies, { composite: 1 });
  assert.equal(stats.ignoredRowCount, 1);
});

test('all fixture-based extractions satisfy the count invariant', () => {
  const fixtureNames = [
    'normal.html',
    'reordered-columns.html',
    'missing-fields.html',
    'missing-credentials.html',
    'duplicates.html',
    'empty-results.html',
    'malformed.html',
    'record-ids.html',
    'unfamiliar-state.html',
    'missing-column.html',
    'multiple-tables.html',
  ];

  for (const name of fixtureNames) {
    const result = extractRecords(fixture(name));
    assertConsistentCounts(result);
    assert.equal(
      result.stats.acceptanceRate +
        result.stats.rejectionRate +
        result.stats.duplicateRate,
      result.totalRows === 0 ? 0 : 1
    );
  }
});
