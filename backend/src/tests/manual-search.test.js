'use strict';

/**
 * Offline tests for the authorized manual-CAPTCHA sample-search mode.
 *
 * These tests never launch a browser, never access the network and never read
 * a live response. They exercise sanitization, structure comparison, response
 * classification, extraction reporting and fixture-path containment.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { extractRecords } = require('../extraction/extractor.service');
const {
  AUTHORIZATION_PHRASE,
  FIXTURE_DIR,
  FIXTURE_PHRASE,
  SUBMIT_PHRASE,
  analyzeResultStructure,
  classifyResponse,
  describeExtractionOutcome,
  isExplicitPhrase,
  resolveFixturePath,
  safeExtractionError,
  sanitizeResultHtml,
  summarizeExtraction,
} = require('../../scripts/test-arrt-manual-search');

const RESULT_TABLE_HTML = `
<div id="searchList">
  <table class="table table-striped">
    <thead>
      <tr>
        <th>Name</th>
        <th>City</th>
        <th>State</th>
        <th>Credential</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Smith, Jane</td>
        <td>Austin</td>
        <td>Texas</td>
        <td>RT-123</td>
      </tr>
      <tr>
        <td>Smith, Jane</td>
        <td>Austin</td>
        <td>TX</td>
        <td>rt-123</td>
      </tr>
      <tr>
        <td>Doe, John</td>
        <td></td>
        <td>CA</td>
        <td>RT-456</td>
      </tr>
    </tbody>
  </table>
</div>`;

test('sanitizer removes executable content, hidden values and unsafe attributes', () => {
  const raw = `<!-- internal comment -->
  <div id="searchList" data-token="attribute-secret">
    <script>var token = 'script-secret';</script>
    <style>.unsafe { color: red; }</style>
    <iframe src="https://example.com/frame"></iframe>
    <input type="hidden" name="__RequestVerificationToken" value="anti-forgery-secret">
    <table class="table table-striped" data-key="detail-key-1">
      <thead>
        <tr><th>Name</th><th>City</th><th>State</th><th>Credential</th></tr>
      </thead>
      <tbody>
        <tr><td>Smith, Jane</td><td>Austin</td><td>TX</td><td>RT-123</td></tr>
      </tbody>
    </table>
    <button onclick="steal()" data-key="detail-key-2">Details</button>
  </div>`;

  const sanitized = sanitizeResultHtml(raw);

  assert.match(sanitized, /<table/);
  assert.match(sanitized, /Smith, Jane/);
  assert.match(sanitized, /class="table table-striped"/);
  assert.match(sanitized, /Details/);
  assert.doesNotMatch(sanitized, /script-secret|anti-forgery-secret|attribute-secret/);
  assert.doesNotMatch(sanitized, /internal comment/);
  assert.doesNotMatch(sanitized, /<script|<style|<iframe|<input/i);
  assert.doesNotMatch(sanitized, /onclick|data-key|data-token|RequestVerificationToken/i);
});

test('structure analysis maps real header labels to the extraction contract', () => {
  const facts = analyzeResultStructure(RESULT_TABLE_HTML);

  assert.equal(facts.hasTable, true);
  assert.equal(facts.tableCount, 1);
  assert.equal(facts.headerRowIndex, 0);
  assert.equal(facts.headerCellCount, 4);
  assert.deepEqual(facts.mappedFields, [
    'fullName',
    'city',
    'state',
    'credentialString',
  ]);
  assert.deepEqual(facts.missingRequiredFields, []);
  assert.equal(facts.unmappedHeaderCount, 0);
  assert.equal(facts.dataRowCandidates, 3);
  assert.equal(facts.hasNoResultsMarker, false);
  assert.equal(facts.dataTableWrappers, 0);
  assert.equal(facts.paginationControls, 0);
});

test('structure analysis reports missing required headers and pagination markers', () => {
  const facts = analyzeResultStructure(`
    <div class="dataTables_wrapper">
      <table>
        <tr><th>Name</th></tr>
        <tr><td>Smith, Jane</td></tr>
      </table>
      <div class="dataTables_paginate"><a href="#">1</a></div>
    </div>`);

  assert.equal(facts.hasTable, true);
  assert.deepEqual(facts.mappedFields, ['fullName']);
  assert.deepEqual(facts.missingRequiredFields, [
    'city',
    'state',
    'credentialString',
  ]);
  assert.equal(facts.dataTableWrappers, 1);
  assert.equal(facts.paginationControls, 1);
});

test('structure analysis reports an unmapped action column alongside a detail control per row', () => {
  const facts = analyzeResultStructure(`
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>City</th>
          <th>State</th>
          <th>Credential</th>
          <th>&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Smith, Jane</td><td>Austin</td><td>TX</td><td>RT-123</td>
          <td><a href="#">Details</a></td>
        </tr>
        <tr>
          <td>Doe, John</td><td>Reno</td><td>NV</td><td>RT-456</td>
          <td><a href="#">Details</a></td>
        </tr>
      </tbody>
    </table>`);

  assert.equal(facts.headerCellCount, 5);
  assert.equal(facts.unmappedHeaderCount, 1);
  assert.deepEqual(facts.mappedFields, [
    'fullName',
    'city',
    'state',
    'credentialString',
  ]);
  assert.equal(facts.detailControlCount, 2);
});

test('structure analysis recognizes a no-results fragment without a table', () => {
  const facts = analyzeResultStructure(
    '<div id="searchList"><p>No records found.</p></div>'
  );

  assert.equal(facts.hasTable, false);
  assert.equal(facts.tableCount, 0);
  assert.equal(facts.hasNoResultsMarker, true);
  assert.deepEqual(facts.missingRequiredFields, [
    'fullName',
    'city',
    'state',
    'credentialString',
  ]);
});

test('response classification distinguishes CAPTCHA, denial, format and body failures', () => {
  assert.equal(
    classifyResponse({
      status: 424,
      contentType: 'text/html',
      responseBytes: 20,
      body: 'Captcha Failure.',
      bodyReadError: null,
    }),
    'captcha_failure'
  );
  assert.equal(
    classifyResponse({
      status: 403,
      contentType: 'text/html',
      responseBytes: 20,
      body: 'Forbidden',
      bodyReadError: null,
    }),
    'access_denied'
  );
  assert.equal(
    classifyResponse({
      status: 429,
      contentType: 'text/html',
      responseBytes: 20,
      body: 'Too many requests',
      bodyReadError: null,
    }),
    'rate_limited'
  );
  assert.equal(
    classifyResponse({
      status: 500,
      contentType: 'text/html',
      responseBytes: 20,
      body: 'Error',
      bodyReadError: null,
    }),
    'server_error'
  );
  assert.equal(
    classifyResponse({
      status: 400,
      contentType: 'text/html',
      responseBytes: 20,
      body: 'Bad request',
      bodyReadError: null,
    }),
    'http_error'
  );
  assert.equal(
    classifyResponse({
      status: 200,
      contentType: 'application/json',
      responseBytes: 2,
      body: '{}',
      bodyReadError: null,
    }),
    'unexpected_content_type'
  );
  assert.equal(
    classifyResponse({
      status: 200,
      contentType: 'text/html',
      responseBytes: 0,
      body: '',
      bodyReadError: null,
    }),
    'empty_body'
  );
  assert.equal(
    classifyResponse({
      status: 200,
      contentType: 'text/html',
      responseBytes: 40,
      body: '<div>Captcha Failure. Please try again.</div>',
      bodyReadError: null,
    }),
    'captcha_failure'
  );
  assert.equal(
    classifyResponse({
      status: 200,
      contentType: 'text/html',
      responseBytes: 20,
      body: '<table></table>',
      bodyReadError: null,
    }),
    'ok'
  );
  assert.equal(
    classifyResponse({
      status: 200,
      contentType: 'text/html',
      responseBytes: 0,
      body: '',
      bodyReadError: 'RESPONSE_BODY_READ_FAILED',
    }),
    'network_error'
  );
});

test('extraction summary reports counts and codes without record values', () => {
  const result = extractRecords(RESULT_TABLE_HTML, { maxRows: 50 });
  const summary = summarizeExtraction(result);

  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.rejectedCount, 1);
  assert.equal(summary.duplicateCount, 1);
  assert.equal(summary.totalRows, 3);
  assert.deepEqual(summary.fields, [
    'fullName',
    'city',
    'state',
    'credentialString',
  ]);
  assert.equal(summary.recordIdPresent, false);
  assert.equal(summary.validationErrorsByCode.MISSING_CITY, 1);
  assert.equal(summary.duplicateStrategies.composite, 1);

  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('Smith'));
  assert.ok(!serialized.includes('Austin'));
  assert.ok(!serialized.includes('RT-123'));
  assert.ok(!serialized.includes('Doe'));
});

test('extraction outcomes separate success, empty results and structural mismatch', () => {
  const successful = extractRecords(RESULT_TABLE_HTML, { maxRows: 50 });

  assert.equal(
    describeExtractionOutcome({
      extraction: successful,
      extractionError: null,
      structure: { hasNoResultsMarker: false, hasTable: true },
    }),
    'captured_and_extracted'
  );

  assert.equal(
    describeExtractionOutcome({
      extraction: { totalRows: 0, acceptedCount: 0 },
      extractionError: null,
      structure: { hasNoResultsMarker: true, hasTable: false },
    }),
    'empty_result'
  );

  assert.equal(
    describeExtractionOutcome({
      extraction: null,
      extractionError: { code: 'TABLE_NOT_FOUND' },
      structure: { hasNoResultsMarker: true, hasTable: false },
    }),
    'empty_result'
  );

  assert.equal(
    describeExtractionOutcome({
      extraction: null,
      extractionError: { code: 'TABLE_NOT_FOUND' },
      structure: { hasNoResultsMarker: false, hasTable: false },
    }),
    'unexpected_structure'
  );

  assert.equal(
    describeExtractionOutcome({
      extraction: null,
      extractionError: { code: 'HEADER_MISMATCH' },
      structure: { hasNoResultsMarker: false, hasTable: true },
    }),
    'unexpected_structure'
  );

  assert.equal(
    describeExtractionOutcome({
      extraction: { totalRows: 1, acceptedCount: 0 },
      extractionError: null,
      structure: { hasNoResultsMarker: false, hasTable: true },
    }),
    'no_accepted_records'
  );
});

test('extraction errors are reduced to safe codes and required field names', () => {
  const safe = safeExtractionError({
    code: 'HEADER_MISMATCH',
    details: {
      missing: ['city', 'state', 'credentialString'],
      headers: ['Smith, Jane', 'Austin', 'TX'],
      foundTables: 1,
      tableIndex: 0,
    },
  });

  assert.deepEqual(safe, {
    code: 'HEADER_MISMATCH',
    missingFields: ['city', 'state', 'credentialString'],
    foundTables: 1,
    tableIndex: 0,
  });
  assert.equal(JSON.stringify(safe).includes('Smith'), false);
});

test('authorization phrases are exact and whitespace-trimmed only', () => {
  assert.equal(isExplicitPhrase(AUTHORIZATION_PHRASE, AUTHORIZATION_PHRASE), true);
  assert.equal(isExplicitPhrase(`  ${AUTHORIZATION_PHRASE}  `, AUTHORIZATION_PHRASE), true);
  assert.equal(isExplicitPhrase(AUTHORIZATION_PHRASE.toLowerCase(), AUTHORIZATION_PHRASE), false);
  assert.equal(isExplicitPhrase('YES', AUTHORIZATION_PHRASE), false);
  assert.equal(isExplicitPhrase('', SUBMIT_PHRASE), false);
  assert.equal(isExplicitPhrase(FIXTURE_PHRASE, FIXTURE_PHRASE), true);
});

test('fixture paths are restricted to the manual fixture directory', () => {
  const resolved = resolveFixturePath('sample.html');
  assert.equal(path.dirname(resolved), path.resolve(FIXTURE_DIR));
  assert.equal(path.basename(resolved), 'sample.html');

  const defaulted = resolveFixturePath(null);
  assert.equal(path.dirname(defaulted), path.resolve(FIXTURE_DIR));
  assert.match(path.basename(defaulted), /^arrt-manual-.+\.html$/);

  assert.throws(() => resolveFixturePath('../escape.html'));
  assert.throws(() => resolveFixturePath('nested/sample.html'));
  assert.throws(() => resolveFixturePath('..\\escape.html'));
  assert.throws(() => resolveFixturePath('C:\\Windows\\sample.html'));
  assert.throws(() => resolveFixturePath('sample.txt'));
});
