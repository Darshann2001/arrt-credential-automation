#!/usr/bin/env node
'use strict';

/**
 * Authorized manual-CAPTCHA sample-search test mode.
 *
 * Purpose:
 *   Validate one real ARRT browser session, the search request, the AJAX
 *   response and the existing Cheerio extraction engine using a single,
 *   operator-approved sample search.
 *
 * This script is intentionally interactive and deliberately separate from the
 * production collection service:
 *   - Chrome runs with headless: false;
 *   - the operator types the sample name and completes reCAPTCHA in the page;
 *   - the script never reads, solves, injects or stores a CAPTCHA token;
 *   - exactly one search is submitted, after two explicit confirmations;
 *   - there are no retries, loops, pagination or bulk collection;
 *   - cookies and anti-forgery values stay inside the browser context and are
 *     never read or written by this script.
 *
 * Fixture saving is off by default. It requires --save-fixture,
 * --fixture-authorized and a final typed confirmation, and writes only
 * sanitized HTML inside backend/fixtures/arrt-manual/.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const cheerio = require('cheerio');

const { extractRecords } = require('../src/extraction/extractor.service');
const { EXTRACTED_FIELDS } = require('../src/extraction/fields');
const {
  DEFAULT_REQUIRED_FIELDS,
  FIELD_ALIASES,
  mapHeaders,
} = require('../src/extraction/column-mapper');
const { directRows } = require('../src/extraction/table-locator');
const { normalizeWhitespace } = require('../src/utils/name-normalizer.util');

const ARRT_URL = 'https://www.arrt.org/pages/verify-credentials';
const SEARCH_PATH = '/VerifyCredentials/SearchByName';

const AUTHORIZATION_PHRASE = 'I AM AUTHORIZED';
const SUBMIT_PHRASE = 'SUBMIT ONE SEARCH';
const FIXTURE_PHRASE = 'SAVE FIXTURE';

const FIXTURE_DIR = path.join(
  __dirname,
  '..',
  'fixtures',
  'arrt-manual'
);

const NO_RESULTS_PATTERN =
  /^(?:no\s+(?:matching\s+)?(?:results?|records?|matches?|data|entries)|nothing\s+found|0\s+(?:results?|records?|matches?))/i;

const SAFE_ATTRIBUTES = new Set([
  'align',
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'class',
  'colspan',
  'headers',
  'height',
  'id',
  'role',
  'rowspan',
  'scope',
  'title',
  'valign',
  'width',
]);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const OUTCOME_EXIT_CODES = Object.freeze({
  captured_and_extracted: 0,
  empty_result: 0,
  captcha_failure: 2,
  access_denied: 3,
  rate_limited: 3,
  unexpected_content_type: 4,
  empty_body: 4,
  http_error: 4,
  server_error: 4,
  network_error: 1,
  unexpected_structure: 1,
  extraction_error: 1,
  no_accepted_records: 1,
  aborted: 5,
});

class OperatorAbortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OperatorAbortError';
    this.code = 'OPERATOR_ABORT';
  }
}

class ManualSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManualSearchError';
    this.code = code;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  const summary = buildBaseSummary(args);
  let prompter = null;
  let browser = null;
  let page = null;

  try {
    prompter = createPrompter();
    await requirePhrase(
      prompter,
      `Authorized sample-search mode.\n` +
        `This will open Chrome and submit exactly ONE live ARRT search using a\n` +
        `CAPTCHA you complete manually. Type exactly "${AUTHORIZATION_PHRASE}"\n` +
        `to confirm the sample search is authorized:`,
      AUTHORIZATION_PHRASE
    );
    summary.authorization.confirmed = true;

    const puppeteer = require('puppeteer-core');
    const executablePath = resolveExecutable(args.executable);

    log('Launching a visible Chrome session...');
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      defaultViewport: { width: 1366, height: 900 },
    });
    summary.browser = {
      headless: false,
      product: await browser.version(),
    };

    page = await browser.newPage();
    page.setDefaultTimeout(args.timeoutMs);

    const tracker = attachObservers(page, summary);

    log('Opening the ARRT verification page...');
    try {
      await page.goto(ARRT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: args.timeoutMs,
      });
    } catch (error) {
      throw new ManualSearchError(
        'PAGE_LOAD_FAILED',
        'The ARRT verification page did not load.'
      );
    }

    summary.page.pageLoads = 1;
    summary.page.finalPath = safePath(page.url());

    await page.waitForSelector('#searchForm #firstname', {
      visible: true,
      timeout: args.timeoutMs,
    });
    await page.waitForSelector('#searchForm #lastname', {
      visible: true,
      timeout: args.timeoutMs,
    });
    await page.waitForSelector('#submitButton', {
      visible: true,
      timeout: args.timeoutMs,
    });
    await page.waitForSelector('.g-recaptcha', {
      timeout: args.timeoutMs,
    });

    summary.page.formReady = true;
    summary.page.captchaReady = await waitForCaptchaWidget(page, args.timeoutMs);

    log(
      '\nIn the Chrome window:\n' +
        '  1. Enter the sample first and last name manually.\n' +
        '  2. Complete the reCAPTCHA checkbox manually.\n' +
        '  3. Do NOT click Search; the script will do that once after confirmation.\n'
    );

    await prompter.question(
      'Press Enter here when the name is entered and the CAPTCHA is complete: '
    );

    const formState = await readFormState(page);
    summary.page.formFilled = formState.filled;
    summary.page.captchaWidgetPresent = formState.captchaPresent;

    if (!formState.filled) {
      throw new OperatorAbortError(
        'The name fields are not filled to the site minimums (first >= 1, last >= 2), ' +
          'or the Search button is unavailable. No search was submitted.'
      );
    }

    await requirePhrase(
      prompter,
      `\nThe script will now submit exactly one search and stop.\n` +
        `Type exactly "${SUBMIT_PHRASE}" to submit:`,
      SUBMIT_PHRASE
    );

    if (tracker.searchRequests > 0) {
      summary.safety.searchesSubmitted = tracker.searchRequests;
      throw new OperatorAbortError(
        'A search request was already observed before the script submitted. ' +
          'No second search was sent.'
      );
    }

    log('Submitting one search and waiting for the response...');
    const capture = await submitAndCapture(page, args.responseTimeoutMs);

    summary.request = {
      endpointPath: SEARCH_PATH,
      method: 'POST',
      status: capture.status,
      contentType: capture.contentType,
      responseDurationMs: capture.responseDurationMs,
      bodyReadDurationMs: capture.bodyReadDurationMs,
      responseBytes: capture.responseBytes,
    };
    summary.safety.searchesSubmitted = tracker.searchRequests;

    const classification = classifyResponse(capture);

    if (classification !== 'ok') {
      summary.outcome = classification;
      summary.response = {
        status: capture.status,
        contentType: capture.contentType,
        bodyBytes: capture.responseBytes,
        bodyReadError: capture.bodyReadError,
      };
      log(`Response classified as: ${classification}`);
      return finish(summary);
    }

    const rawHtml = capture.body;
    summary.structure = analyzeResultStructure(rawHtml);

    const sanitizedHtml = sanitizeResultHtml(rawHtml);
    summary.capture = {
      rawBytes: Buffer.byteLength(rawHtml, 'utf8'),
      sanitizedBytes: Buffer.byteLength(sanitizedHtml, 'utf8'),
      sanitizedSha256: sha256(sanitizedHtml),
      scriptsRemoved: summary.structure.scriptCount,
      paginationFollowed: false,
    };

    let extraction = null;
    let extractionError = null;

    try {
      extraction = extractRecords(
        { html: sanitizedHtml, fixture: null },
        { maxRows: 500 }
      );
    } catch (error) {
      extractionError = safeExtractionError(error);
    }

    const extractionOutcome = describeExtractionOutcome({
      extraction,
      extractionError,
      structure: summary.structure,
    });

    summary.extraction = {
      outcome: extractionOutcome,
      ...(extraction ? summarizeExtraction(extraction) : {}),
      ...(extractionError ? { error: extractionError } : {}),
    };

    summary.compatibility = {
      expectedRequiredHeaders: DEFAULT_REQUIRED_FIELDS,
      knownHeaderAliases: Object.fromEntries(
        Object.entries(FIELD_ALIASES).map(([field, aliases]) => [
          field,
          aliases.length,
        ])
      ),
      tableFound: summary.structure.hasTable,
      requiredHeadersMatched:
        summary.structure.missingRequiredFields.length === 0,
      mappedFields: summary.structure.mappedFields,
      missingRequiredFields: summary.structure.missingRequiredFields,
      unmappedHeaderCount: summary.structure.unmappedHeaderCount,
      paginationAssumption:
        'one response equals one result page; no paging is implemented',
      paginationObserved:
        summary.structure.paginationControls > 0 ||
        summary.structure.dataTableWrappers > 0,
      recordIdAssumption:
        'recordId is read only from a mapped table header, not from detail controls',
      detailControlsObserved: summary.structure.detailControlCount > 0,
    };

    await maybeSaveFixture({
      prompter,
      args,
      sanitizedHtml,
      summary,
    });

    summary.outcome = extractionOutcome;
    return finish(summary);
  } catch (error) {
    if (error instanceof OperatorAbortError) {
      summary.outcome = 'aborted';
      summary.abortReason = error.message;
    } else if (error instanceof ManualSearchError) {
      if (
        error.code === 'INTERACTIVE_TERMINAL_REQUIRED' ||
        error.code === 'BROWSER_NOT_FOUND' ||
        error.code === 'INVALID_ARGUMENT' ||
        error.code === 'INVALID_FIXTURE_PATH'
      ) {
        summary.outcome = 'aborted';
        summary.abortReason = error.message;
      } else {
        summary.outcome =
          error.code === 'SEARCH_RESPONSE_TIMEOUT' ||
          error.code === 'PAGE_LOAD_FAILED' ||
          error.code === 'SUBMIT_CLICK_FAILED' ||
          error.code === 'RESPONSE_BODY_READ_FAILED'
            ? 'network_error'
            : 'extraction_error';
        summary.error = { code: error.code, message: error.message };
      }
    } else {
      summary.outcome = 'extraction_error';
      summary.error = {
        code: error?.code || 'UNEXPECTED_ERROR',
        message: 'The manual sample run failed before a complete result was captured.',
      };
    }

    return finish(summary);
  } finally {
    if (page) {
      summary.safety.searchesSubmitted = Math.max(
        summary.safety.searchesSubmitted,
        0
      );
      await page.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (prompter) {
      prompter.close();
    }
  }
}

function buildBaseSummary(args) {
  return {
    mode: 'manual-single-search',
    generatedAt: new Date().toISOString(),
    targetUrl: ARRT_URL,
    outcome: 'not_started',
    authorization: {
      confirmed: false,
      reference: args.authorizationReference || null,
    },
    browser: {
      headless: false,
      product: null,
    },
    page: {
      pageLoads: 0,
      finalPath: null,
      formReady: false,
      captchaReady: false,
      formFilled: false,
      captchaWidgetPresent: false,
    },
    request: null,
    response: null,
    structure: null,
    capture: null,
    extraction: null,
    compatibility: null,
    fixture: {
      offered: false,
      saved: false,
      fileName: null,
      reason: 'not requested',
    },
    network: {
      failedRequests: [],
    },
    safety: {
      searchesSubmitted: 0,
      searchesAllowed: 1,
      retries: 0,
      paginationFollowed: false,
      captchaTokenRead: false,
      captchaTokenInjected: false,
      captchaSolvedByScript: false,
      cookiesRead: false,
      sessionIdsRead: false,
      antiForgeryValueRead: false,
      formValuesLogged: false,
      fixtureSavedOnlyWithConfirmation: true,
    },
  };
}

function createPrompter() {
  if (!process.stdin.isTTY) {
    throw new ManualSearchError(
      'INTERACTIVE_TERMINAL_REQUIRED',
      'This mode requires an interactive terminal. It will not run from a pipe or unattended job.'
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    question: (text) => rl.question(text),
    close: () => rl.close(),
  };
}

async function requirePhrase(prompter, question, phrase) {
  const answer = await prompter.question(`\n${question}\n> `);

  if (!isExplicitPhrase(answer, phrase)) {
    throw new OperatorAbortError(
      `Confirmation phrase did not match. Expected exactly "${phrase}". No search was submitted.`
    );
  }
}

function isExplicitPhrase(value, phrase) {
  return typeof value === 'string' && value.trim() === phrase;
}

async function waitForCaptchaWidget(page, timeoutMs) {
  return page
    .waitForFunction(
      () =>
        typeof window.grecaptcha !== 'undefined' ||
        Boolean(document.querySelector('.g-recaptcha iframe')) ||
        Boolean(document.querySelector('iframe[title*="reCAPTCHA"]')),
      { timeout: Math.min(timeoutMs, 30000) }
    )
    .then(() => true)
    .catch(() => false);
}

async function readFormState(page) {
  const facts = await page.evaluate(() => {
    const firstName = document.querySelector('#firstname');
    const lastName = document.querySelector('#lastname');
    const submit = document.querySelector('#submitButton');
    const widget = document.querySelector('.g-recaptcha');

    return {
      firstNameLength: firstName ? firstName.value.trim().length : 0,
      lastNameLength: lastName ? lastName.value.trim().length : 0,
      submitDisabled: Boolean(submit?.disabled),
      captchaPresent: Boolean(widget),
    };
  });

  return {
    filled:
      facts.firstNameLength >= 1 &&
      facts.lastNameLength >= 2 &&
      !facts.submitDisabled,
    captchaPresent: facts.captchaPresent,
  };
}

function attachObservers(page, summary) {
  const tracker = {
    searchRequests: 0,
    failedRequests: [],
  };

  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      isSearchRequestUrl(request.url())
    ) {
      tracker.searchRequests += 1;
    }
  });

  page.on('requestfailed', (request) => {
    tracker.failedRequests.push({
      path: safePath(request.url()),
      errorText: request.failure()?.errorText || null,
    });
  });

  summary.network.failedRequests = tracker.failedRequests;
  return tracker;
}

async function submitAndCapture(page, timeoutMs) {
  const startedAt = process.hrtime.bigint();
  const responsePromise = page.waitForResponse(
    (response) =>
      isSearchRequestUrl(response.url()) &&
      response.request().method() === 'POST',
    { timeout: timeoutMs }
  );

  try {
    await page.click('#submitButton');
  } catch (error) {
    responsePromise.catch(() => {});
    throw new ManualSearchError(
      'SUBMIT_CLICK_FAILED',
      'The Search button could not be clicked. No search may have been submitted.'
    );
  }

  let response;

  try {
    response = await responsePromise;
  } catch (error) {
    throw new ManualSearchError(
      'SEARCH_RESPONSE_TIMEOUT',
      'No search response was observed. The CAPTCHA may be incomplete or the site may have blocked the submission. No retry was attempted.'
    );
  }

  const responseDurationMs = elapsedMs(startedAt);
  const status = response.status();
  const contentType = response.headers()['content-type'] || null;

  const bodyStartedAt = process.hrtime.bigint();
  let body = '';
  let bodyReadError = null;

  try {
    body = await response.text();
  } catch (error) {
    bodyReadError = 'RESPONSE_BODY_READ_FAILED';
  }

  const bodyReadDurationMs = elapsedMs(bodyStartedAt);

  return {
    status,
    contentType,
    responseDurationMs,
    bodyReadDurationMs,
    responseBytes: Buffer.byteLength(body || '', 'utf8'),
    body,
    bodyReadError,
  };
}

function classifyResponse(capture) {
  if (capture.bodyReadError) {
    return 'network_error';
  }

  if (capture.status === 424) {
    return 'captcha_failure';
  }

  if (capture.status === 403) {
    return 'access_denied';
  }

  if (capture.status === 429) {
    return 'rate_limited';
  }

  if (capture.status >= 500) {
    return 'server_error';
  }

  if (capture.status >= 400) {
    return 'http_error';
  }

  if (!capture.responseBytes) {
    return 'empty_body';
  }

  const type = String(capture.contentType || '').toLowerCase();
  const htmlLike = type.includes('html') || type.includes('text/plain') || !type;

  if (!htmlLike) {
    return 'unexpected_content_type';
  }

  if (/captcha\s+failure/i.test(capture.body || '')) {
    return 'captcha_failure';
  }

  return 'ok';
}

function analyzeResultStructure(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return {
      hasTable: false,
      tableCount: 0,
      headerRowIndex: null,
      headerCellCount: 0,
      unmappedHeaderCount: 0,
      mappedFields: [],
      missingRequiredFields: [...DEFAULT_REQUIRED_FIELDS],
      dataRowCandidates: 0,
      hasNoResultsMarker: false,
      dataTableWrappers: 0,
      paginationControls: 0,
      scriptCount: 0,
      detailControlCount: 0,
      formControlCount: 0,
      rawBytes: 0,
    };
  }

  const $ = cheerio.load(html, null, false);

  const tableFacts = $('table')
    .toArray()
    .map((table, index) => {
      const rows = directRows($, table);
      let best = null;

      rows.slice(0, 5).forEach((row, rowIndex) => {
        const cells = $(row).children('th, td').toArray();

        if (cells.length === 0) {
          return;
        }

        const labels = cells.map((cell) =>
          normalizeWhitespace($(cell).text())
        );

        if (labels.every((label) => !label)) {
          return;
        }

        const mapping = mapHeaders(labels, {
          requiredFields: DEFAULT_REQUIRED_FIELDS,
        });
        const score = Object.keys(mapping.columns).length;

        if (score > 0 && (!best || score > best.score)) {
          best = { rowIndex, labels, mapping, score };
        }
      });

      return {
        index,
        headerRowIndex: best ? best.rowIndex : null,
        headerCellCount: best ? best.labels.length : 0,
        mappedFields: best ? Object.keys(best.mapping.columns) : [],
        missingRequiredFields: best
          ? best.mapping.missing
          : [...DEFAULT_REQUIRED_FIELDS],
        mappedColumnCount: best ? best.score : 0,
        unmappedHeaderCount: best
          ? Math.max(0, best.labels.length - best.score)
          : 0,
        dataRowCandidates: Math.max(
          0,
          rows.length - (best ? best.rowIndex + 1 : 0)
        ),
      };
    });

  const bestTable = tableFacts.reduce(
    (best, table) =>
      !best || table.mappedColumnCount > best.mappedColumnCount ? table : best,
    null
  );

  const rootText = normalizeWhitespace($.root().text());

  return {
    hasTable: tableFacts.length > 0,
    tableCount: tableFacts.length,
    headerRowIndex: bestTable ? bestTable.headerRowIndex : null,
    headerCellCount: bestTable ? bestTable.headerCellCount : 0,
    unmappedHeaderCount: bestTable ? bestTable.unmappedHeaderCount : 0,
    mappedFields: bestTable ? bestTable.mappedFields : [],
    missingRequiredFields: bestTable
      ? bestTable.missingRequiredFields
      : [...DEFAULT_REQUIRED_FIELDS],
    dataRowCandidates: bestTable ? bestTable.dataRowCandidates : 0,
    hasNoResultsMarker: NO_RESULTS_PATTERN.test(rootText),
    dataTableWrappers: $('.dataTables_wrapper').length,
    paginationControls: $('.dataTables_paginate, .pagination').length,
    scriptCount: $('script').length,
    detailControlCount: countDetailControls($),
    formControlCount: $('input, select, textarea').length,
    rawBytes: Buffer.byteLength(html, 'utf8'),
  };
}

function countDetailControls($) {
  return $('button, a')
    .toArray()
    .filter((element) => {
      const text = normalizeWhitespace($(element).text());
      const attributeNames = Object.keys(element.attribs || {}).map((name) =>
        name.toLowerCase()
      );

      return (
        /detail|view/i.test(text) ||
        attributeNames.some(
          (name) => name.includes('key') || name.includes('detail')
        )
      );
    }).length;
}

function sanitizeResultHtml(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }

  const $ = cheerio.load(html, null, false);

  $(
    'script, style, link, iframe, object, embed, meta, base, noscript, template, input, textarea, select, option'
  ).remove();

  $('*').each((_, element) => {
    if (!element.attribs) {
      return;
    }

    for (const name of Object.keys(element.attribs)) {
      const lower = name.toLowerCase();

      if (!SAFE_ATTRIBUTES.has(lower) && !lower.startsWith('aria-')) {
        delete element.attribs[name];
      }
    }
  });

  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  $.root()
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  return $.html();
}

function summarizeExtraction(result) {
  const records = Array.isArray(result.records) ? result.records : [];
  const firstRecord = records[0] || null;
  const fields = firstRecord
    ? Object.keys(firstRecord)
        .filter((key) => key !== 'source')
        .filter(
          (key) =>
            key !== 'recordId' || records.some((record) => record.recordId)
        )
    : [...EXTRACTED_FIELDS];
  const stats = result.stats || {};

  return {
    fields,
    acceptedCount: result.acceptedCount || 0,
    rejectedCount: result.rejectedCount || 0,
    duplicateCount: result.duplicateCount || 0,
    totalRows: result.totalRows || 0,
    ignoredRowCount: stats.ignoredRowCount || 0,
    recordIdPresent: records.some((record) => Boolean(record.recordId)),
    validationErrorsByCode: stats.allErrorsByCode || {},
    primaryErrorsByCode: stats.primaryErrorsByCode || {},
    duplicateStrategies: stats.duplicateStrategies || {},
    acceptanceRate: stats.acceptanceRate || 0,
  };
}

function safeExtractionError(error) {
  const details = error?.details || {};
  const safe = {
    code: error?.code || 'EXTRACTION_ERROR',
  };

  if (Array.isArray(details.missing)) {
    safe.missingFields = details.missing.filter((field) =>
      DEFAULT_REQUIRED_FIELDS.includes(field)
    );
  }

  if (Number.isInteger(details.foundTables)) {
    safe.foundTables = details.foundTables;
  }

  if (Number.isInteger(details.tableIndex)) {
    safe.tableIndex = details.tableIndex;
  }

  return safe;
}

function describeExtractionOutcome({ extraction, extractionError, structure }) {
  if (extraction) {
    const totalRows = extraction.totalRows || 0;
    const acceptedCount = extraction.acceptedCount || 0;

    if (totalRows === 0 && (structure.hasNoResultsMarker || !structure.hasTable)) {
      return 'empty_result';
    }

    if (acceptedCount === 0) {
      return 'no_accepted_records';
    }

    return 'captured_and_extracted';
  }

  if (extractionError) {
    if (
      extractionError.code === 'TABLE_NOT_FOUND' &&
      structure.hasNoResultsMarker
    ) {
      return 'empty_result';
    }

    if (
      extractionError.code === 'TABLE_NOT_FOUND' ||
      extractionError.code === 'HEADER_MISMATCH'
    ) {
      return 'unexpected_structure';
    }

    return 'extraction_error';
  }

  return 'extraction_error';
}

async function maybeSaveFixture({ prompter, args, sanitizedHtml, summary }) {
  if (!args.saveFixture) {
    summary.fixture = {
      offered: false,
      saved: false,
      fileName: null,
      reason: 'fixture saving was not requested',
    };
    return;
  }

  if (!args.fixtureAuthorized) {
    summary.fixture = {
      offered: false,
      saved: false,
      fileName: null,
      reason:
        'fixture saving requires --fixture-authorized and a final confirmation',
    };
    return;
  }

  summary.fixture = {
    offered: true,
    saved: false,
    fileName: null,
    reason: 'awaiting final confirmation',
  };

  try {
    await requirePhrase(
      prompter,
      `\nFixture saving is enabled. The sanitized result HTML may contain personal\n` +
        `data. Type exactly "${FIXTURE_PHRASE}" only if the site's authorization and\n` +
        `data-handling rules permit storing it locally:`,
      FIXTURE_PHRASE
    );
  } catch (error) {
    summary.fixture.reason = 'final fixture confirmation was not entered';
    return;
  }

  let fixturePath;

  try {
    fixturePath = resolveFixturePath(args.fixtureName);
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  } catch (error) {
    summary.fixture = {
      offered: true,
      saved: false,
      fileName: null,
      reason: 'fixture path was invalid or the fixture directory could not be created',
    };
    return;
  }

  const notice =
    '<!-- ARRT manual sample fixture. Sanitized response HTML may contain ' +
    'personal data. Store and share only under the site authorization and ' +
    'data-handling rules. -->\n';

  try {
    fs.writeFileSync(fixturePath, `${notice}${sanitizedHtml}\n`, 'utf8');
  } catch (error) {
    summary.fixture = {
      offered: true,
      saved: false,
      fileName: null,
      reason: 'fixture write failed; no fixture was saved',
    };
    return;
  }

  summary.fixture = {
    offered: true,
    saved: true,
    fileName: path.basename(fixturePath),
    reason: 'saved after explicit authorization, permission and confirmation',
  };

  log(`Sanitized fixture saved to: ${fixturePath}`);
}

function resolveFixturePath(name) {
  const defaultName = `arrt-manual-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.html`;
  const candidate = name || defaultName;

  if (candidate !== path.basename(candidate)) {
    throw new ManualSearchError(
      'INVALID_FIXTURE_PATH',
      'The fixture name must be a simple file name inside backend/fixtures/arrt-manual/.'
    );
  }

  if (!/\.html?$/i.test(candidate)) {
    throw new ManualSearchError(
      'INVALID_FIXTURE_PATH',
      'The fixture name must end with .html or .htm.'
    );
  }

  const resolvedDirectory = path.resolve(FIXTURE_DIR);
  const resolved = path.resolve(resolvedDirectory, candidate);

  if (path.dirname(resolved) !== resolvedDirectory) {
    throw new ManualSearchError(
      'INVALID_FIXTURE_PATH',
      'The fixture path must stay inside backend/fixtures/arrt-manual/.'
    );
  }

  return resolved;
}

function isSearchRequestUrl(value) {
  try {
    return new URL(value).pathname.toLowerCase() === SEARCH_PATH.toLowerCase();
  } catch {
    return false;
  }
}

function safePath(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol === 'data:') {
      return 'data:';
    }

    return url.pathname;
  } catch {
    return null;
  }
}

function resolveExecutable(explicitPath) {
  const candidates = explicitPath
    ? [explicitPath, ...CHROME_CANDIDATES]
    : CHROME_CANDIDATES;
  const found = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate)
  );

  if (!found) {
    throw new ManualSearchError(
      'BROWSER_NOT_FOUND',
      'No Chrome/Edge executable found. Set CHROME_PATH or pass --executable <path>.'
    );
  }

  return found;
}

function parseArgs(argv) {
  const args = {
    help: false,
    timeoutMs: 45000,
    responseTimeoutMs: 60000,
    executable: null,
    saveFixture: false,
    fixtureAuthorized: false,
    fixtureName: null,
    authorizationReference: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--save-fixture') {
      args.saveFixture = true;
    } else if (arg === '--fixture-authorized') {
      args.fixtureAuthorized = true;
    } else if (arg === '--timeout') {
      args.timeoutMs = readMilliseconds(
        readValue(argv, ++index, '--timeout'),
        '--timeout'
      );
    } else if (arg === '--response-timeout') {
      args.responseTimeoutMs = readMilliseconds(
        readValue(argv, ++index, '--response-timeout'),
        '--response-timeout'
      );
    } else if (arg === '--executable') {
      args.executable = readValue(argv, ++index, '--executable');
    } else if (arg === '--fixture-name') {
      args.fixtureName = readValue(argv, ++index, '--fixture-name');
    } else if (arg === '--authorization-reference') {
      args.authorizationReference = readValue(
        argv,
        ++index,
        '--authorization-reference'
      );
    } else {
      throw new ManualSearchError(
        'INVALID_ARGUMENT',
        `Unknown argument: ${arg}`
      );
    }
  }

  if (args.fixtureName && !args.saveFixture) {
    throw new ManualSearchError(
      'INVALID_ARGUMENT',
      '--fixture-name requires --save-fixture.'
    );
  }

  return args;
}

function readValue(argv, index, name) {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new ManualSearchError(
      'INVALID_ARGUMENT',
      `${name} requires a value.`
    );
  }

  return value;
}

function readMilliseconds(value, name) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 600000) {
    throw new ManualSearchError(
      'INVALID_ARGUMENT',
      `${name} must be an integer between 1000 and 600000 milliseconds.`
    );
  }

  return parsed;
}

function formatOutcome(summary) {
  return OUTCOME_EXIT_CODES[summary.outcome] ?? 1;
}

function finish(summary) {
  summary.exitCode = formatOutcome(summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary.exitCode;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function elapsedMs(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
}

function log(message) {
  console.error(message);
}

function printHelp() {
  console.log(`Usage: npm run test:arrt:manual [-- options]

Authorized manual-CAPTCHA sample mode. One live search, one response, one
extraction run. This command is separate from the production collector.

Options:
  --authorization-reference <text>  Optional internal authorization reference.
  --timeout <ms>                    Page/navigation timeout (default: 45000).
  --response-timeout <ms>           Search response timeout (default: 60000).
  --executable <path>               Chrome/Edge executable path.
  --save-fixture                    Offer to save sanitized response HTML.
  --fixture-authorized              Confirm data-handling rules permit saving.
  --fixture-name <name>             Fixture file name (default: timestamped).
  --help, -h                        Show this help.

Safety rules enforced by this mode:
  - interactive terminal only; refuses pipes and unattended execution;
  - typing "${AUTHORIZATION_PHRASE}" is required before Chrome opens;
  - headless is always false;
  - the operator enters the name and completes the CAPTCHA manually;
  - typing "${SUBMIT_PHRASE}" is required before the one submission;
  - no CAPTCHA solving, token reading, token injection or token storage;
  - no cookie, session-id or anti-forgery value reading or storage;
  - no retries, loops, automatic pagination or bulk collection;
  - fixture saving requires both flags and a final "${FIXTURE_PHRASE}" phrase.

Exit codes:
  0  result captured and extracted, or a confirmed empty result
  1  unexpected structure, extraction error, or network error
  2  CAPTCHA failure (HTTP 424)
  3  access denied (403) or rate limited (429)
  4  unexpected content type, empty body, or other HTTP error
  5  operator aborted or authorization phrase not entered`);
}

module.exports = {
  AUTHORIZATION_PHRASE,
  SUBMIT_PHRASE,
  FIXTURE_PHRASE,
  FIXTURE_DIR,
  OUTCOME_EXIT_CODES,
  analyzeResultStructure,
  classifyResponse,
  describeExtractionOutcome,
  isExplicitPhrase,
  resolveFixturePath,
  safeExtractionError,
  sanitizeResultHtml,
  summarizeExtraction,
};

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const isArgumentError = error?.code === 'INVALID_ARGUMENT';

      console.error(
        JSON.stringify(
          {
            outcome: isArgumentError ? 'aborted' : 'extraction_error',
            error: {
              code: error?.code || 'UNEXPECTED_ERROR',
              message: isArgumentError
                ? error.message
                : 'The manual sample mode failed before it could produce a summary.',
            },
            note: 'No retry was attempted. No token or cookie value was stored.',
          },
          null,
          2
        )
      );
      process.exitCode = isArgumentError ? 5 : 1;
    });
}
