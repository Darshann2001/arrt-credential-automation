'use strict';

/**
 * ARRT Verify Credentials adapter.
 *
 * Status: supervised live search, operator solves the reCAPTCHA by hand.
 *
 * Observed public-page facts (2026-11-17) are encoded as constants. The adapter
 * does not implement a CAPTCHA solver, token read/injection, stealth or proxy
 * rotation. It fills the name fields, waits for the operator to solve the
 * visible challenge and submit, then reads the results HTML.
 */

const cheerio = require('cheerio');

const { extractRecords } = require('../extraction/extractor.service');
const { AUTOMATION_CODES, AutomationError } = require('./errors');
const { PROVIDER_MODES } = require('./providers/data-source.provider');
const {
  detectCaptchaInHtml,
  createPageHandler,
} = require('./page-handler');

const ARRT_PAGE_URL = 'https://www.arrt.org/pages/verify-credentials';

// The result list is a client-side DataTables grid (the site's own
// VerifyCredentialsList.js sets no serverSide/ajax option). The single search
// response already contains every row; DataTables only hides rows outside the
// current page. Reading its full in-memory data set avoids per-page clicking.
const RESULTS_TABLE_ID = 'grid';

const ARRT_OBSERVED = Object.freeze({
  pageUrl: ARRT_PAGE_URL,
  searchEndpoint: '/VerifyCredentials/SearchByName',
  detailsEndpoint: '/VerifyCredentials/GetDisplayDetails',
  captcha: Object.freeze({
    provider: 'google-recaptcha',
    type: 'reCAPTCHA v2 checkbox',
    siteKey: '6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q',
    scriptUrl: 'https://www.google.com/recaptcha/api.js',
    responseAccessor: 'grecaptcha.getResponse()',
    resetAccessor: 'grecaptcha.reset()',
    serverFailureStatus: 424,
  }),
  selectors: Object.freeze({
    form: '#searchForm',
    firstName: '#firstname',
    lastName: '#lastname',
    submit: '#submitButton',
    results: '#searchList',
    captcha: '.g-recaptcha',
    antiforgery: 'input[name="__RequestVerificationToken"]',
  }),
  searchConstraints: Object.freeze({
    firstNameMinLength: 1,
    lastNameMinLength: 2,
    source: 'client-side attributes observed on the public page',
  }),
  requestShape: Object.freeze({
    method: 'POST',
    antiforgeryHeader: 'RequestVerificationToken',
    antiforgeryField: '__RequestVerificationToken',
    bodyFields: Object.freeze(['firstName', 'lastName', 'captchaSuccessCode']),
  }),
  evidenceDate: '2026-11-17',
});

/**
 * Reads the full DataTables cache together with the total the grid reports to
 * the operator. Counting both in the same page-side call lets the caller prove
 * that no client-side page was missed. Never touches CAPTCHA state, cookies or
 * tokens. Returns null when the grid is not available.
 */
async function readGridSnapshot(page) {
  if (typeof page.evaluate !== 'function') {
    return null;
  }

  try {
    return await page.evaluate((tableId) => {
      const jq = window.jQuery;
      if (!jq || !jq.fn || !jq.fn.DataTable || !document.getElementById(tableId)) {
        return null;
      }

      const table = jq(`#${tableId}`).DataTable();
      const info = table.page.info();
      const headers = jq(`#${tableId} thead th`)
        .map((_, th) => jq(th).text().replace(/\s+/g, ' ').trim())
        .get();

      const rows = table
        .rows()
        .data()
        .toArray()
        .map((cells) =>
          Array.from(cells).map((cell) => {
            if (typeof cell !== 'string') {
              return cell == null
                ? ''
                : String(cell).replace(/\s+/g, ' ').trim();
            }
            const div = document.createElement('div');
            div.innerHTML = cell;
            return (div.textContent || '').replace(/\s+/g, ' ').trim();
          })
        );

      const infoEl = document.getElementById('grid_info');

      return {
        headers,
        rows,
        rowCount: rows.length,
        displayedTotal: Number.isFinite(info.recordsTotal)
          ? info.recordsTotal
          : null,
        infoText: infoEl
          ? (infoEl.textContent || '').replace(/\s+/g, ' ').trim()
          : '',
      };
    }, RESULTS_TABLE_ID);
  } catch (error) {
    return null;
  }
}

async function readDataTableRows(page) {
  const snapshot = await readGridSnapshot(page);
  return snapshot ? { headers: snapshot.headers, rows: snapshot.rows } : null;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Rebuilds a parseable table from the full DataTables row set. */
function tableDataToHtml(data) {
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const head = `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`;
  const body = data.rows
    .map((cells) => {
      const limited = headers.length ? cells.slice(0, headers.length) : cells;
      return `<tr>${limited.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    })
    .join('');

  return `<table id="${RESULTS_TABLE_ID}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/**
 * Returns HTML containing every result row for an already-submitted query.
 * Reads the full client-side grid at once and verifies the row count against
 * the total DataTables displays to the operator. If the grid cannot be read or
 * the counts disagree, the search fails closed: no partial DOM page is ever
 * treated as a successful result.
 */
async function collectAllResultPages(page, handler, firstHtml) {
  const snapshot = await readGridSnapshot(page);

  if (!snapshot || !Array.isArray(snapshot.rows)) {
    throw new AutomationError(
      'ARRT results could not be verified: the DataTables grid was unavailable.',
      {
        code: AUTOMATION_CODES.RESULT_COUNT_MISMATCH,
        retryable: false,
        details: { reason: 'datatable-unavailable' },
      }
    );
  }

  if (!Number.isInteger(snapshot.displayedTotal) || snapshot.displayedTotal < 0) {
    throw new AutomationError(
      'ARRT results could not be verified: the grid did not report a total.',
      {
        code: AUTOMATION_CODES.RESULT_COUNT_MISMATCH,
        retryable: false,
        details: { reason: 'total-unavailable', infoText: snapshot.infoText },
      }
    );
  }

  if (snapshot.rowCount !== snapshot.displayedTotal) {
    throw new AutomationError(
      `ARRT result count mismatch: read ${snapshot.rowCount} row(s) but the grid reports ${snapshot.displayedTotal}.`,
      {
        code: AUTOMATION_CODES.RESULT_COUNT_MISMATCH,
        retryable: false,
        details: {
          reason: 'row-count-mismatch',
          rowCount: snapshot.rowCount,
          displayedTotal: snapshot.displayedTotal,
          infoText: snapshot.infoText,
        },
      }
    );
  }

  return {
    html: tableDataToHtml(snapshot),
    rowCount: snapshot.rowCount,
    displayedTotal: snapshot.displayedTotal,
    source: 'datatable-api',
    verified: true,
  };
}

/**
 * @param {object} [options]
 * @param {object|null} [options.authorization]
 * @param {boolean} [options.authorization.confirmed]
 * @param {string} [options.authorization.reference]
 * @param {string[]} [options.authorization.scope]
 * @param {object|null} [options.captcha]
 * @param {boolean} [options.captcha.approved]
 * @param {string} [options.captcha.approvalReference]
 * @param {object} [options.extraction]
 * @param {(() => Promise<{ page: object, handler: object }>)|null} [options.pageFactory]
 * @param {((level: string, message: string) => void)|null} [options.onEvent]
 * @param {number} [options.captchaWaitMs=300000]
 */
function createArrtAdapter(options = {}) {
  const authorization = options.authorization || null;
  const captchaApproval = options.captcha || null;
  const extractionOptions = options.extraction || {};
  const pageFactory =
    typeof options.pageFactory === 'function' ? options.pageFactory : null;
  const onEvent =
    typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const captchaWaitMs =
    Number.isInteger(options.captchaWaitMs) && options.captchaWaitMs > 0
      ? options.captchaWaitMs
      : 300000;

  function checkAuthorization() {
    if (
      !authorization ||
      authorization.confirmed !== true ||
      typeof authorization.reference !== 'string' ||
      !authorization.reference.trim()
    ) {
      throw new AutomationError(
        'ARRT live search is blocked: written authorization is not confirmed.',
        {
          code: AUTOMATION_CODES.AUTHORIZATION_NOT_CONFIRMED,
          retryable: false,
          details: {
            required: ['authorization.confirmed=true', 'authorization.reference'],
            pageUrl: ARRT_PAGE_URL,
          },
        }
      );
    }

    return true;
  }

  function checkCaptchaApproval() {
    if (
      !captchaApproval ||
      captchaApproval.approved !== true ||
      typeof captchaApproval.approvalReference !== 'string' ||
      !captchaApproval.approvalReference.trim()
    ) {
      throw new AutomationError(
        'ARRT search is CAPTCHA-gated; no approved CAPTCHA procedure is recorded.',
        {
          code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL,
          retryable: false,
          details: {
            captcha: ARRT_OBSERVED.captcha,
            required: ['captcha.approved=true', 'captcha.approvalReference'],
          },
        }
      );
    }

    return true;
  }

  /**
   * Offline analysis of a saved public page or result fragment.
   *
   * @param {string} html
   * @returns {object}
   */
  function analyzePage(html) {
    if (typeof html !== 'string' || !html.trim()) {
      throw new AutomationError('analyzePage requires non-empty HTML.', {
        code: AUTOMATION_CODES.INVALID_OPTIONS,
        details: { field: 'html' },
      });
    }

    const $ = cheerio.load(html);
    const captcha = detectCaptchaInHtml(html, { url: ARRT_PAGE_URL });
    const scriptText = $('script')
      .map((_, element) => $(element).html() || '')
      .get()
      .join('\n');
    const endpoints = {
      search: scriptText.includes('/VerifyCredentials/SearchByName'),
      details: scriptText.includes('/VerifyCredentials/GetDisplayDetails'),
    };

    return {
      pageUrl: ARRT_PAGE_URL,
      captcha,
      observed: {
        searchForm: $(ARRT_OBSERVED.selectors.form).length > 0,
        firstNameInput: $(ARRT_OBSERVED.selectors.firstName).length > 0,
        lastNameInput: $(ARRT_OBSERVED.selectors.lastName).length > 0,
        resultsContainer: $(ARRT_OBSERVED.selectors.results).length > 0,
        antiforgeryField: $(ARRT_OBSERVED.selectors.antiforgery).length > 0,
        searchEndpointVisible: endpoints.search,
        detailsEndpointVisible: endpoints.details,
      },
      schema: {
        captcha: ARRT_OBSERVED.captcha,
        requestShape: ARRT_OBSERVED.requestShape,
        searchConstraints: ARRT_OBSERVED.searchConstraints,
      },
    };
  }

  /**
   * Offline extraction of a result HTML fragment with the existing engine.
   *
   * @param {string} html
   * @param {object} [context]
   * @returns {object}
   */
  function parseResultsHtml(html, context = {}) {
    return extractRecords(
      {
        html,
        page: context.page ?? 1,
        fixture: context.fixture ?? 'arrt-result-fragment.html',
        sourceUrl: context.sourceUrl ?? ARRT_PAGE_URL,
      },
      extractionOptions
    );
  }

  /**
   * Supervised live fetch. The operator solves the visible challenge; this
   * function never reads, injects or bypasses a CAPTCHA token.
   */
  async function fetchPage(search) {
    checkAuthorization();
    checkCaptchaApproval();

    if (!pageFactory) {
      throw new AutomationError(
        'A page factory is required for live ARRT searches.',
        {
          code: AUTOMATION_CODES.BROWSER_UNAVAILABLE,
          retryable: false,
        }
      );
    }

    const { page, handler } = await pageFactory();

    try {
      await handler.goto(ARRT_PAGE_URL);

      await page.$eval(ARRT_OBSERVED.selectors.firstName, (element) => {
        element.value = '';
      });
      await page.$eval(ARRT_OBSERVED.selectors.lastName, (element) => {
        element.value = '';
      });
      await handler.fill(ARRT_OBSERVED.selectors.firstName, search.firstName);
      await handler.fill(ARRT_OBSERVED.selectors.lastName, search.lastName);

      const captcha = await handler.detectCaptcha();

      if (captcha.present) {
        onEvent(
          'WARN',
          `CAPTCHA detected for ${search.firstName} / ${search.lastName}. Solve it in the visible Chrome window, then submit the form.`
        );
      } else {
        await handler.click(ARRT_OBSERVED.selectors.submit);
      }

      try {
        await handler.waitForResults(
          ARRT_OBSERVED.selectors.results,
          captchaWaitMs
        );
      } catch (error) {
        throw new AutomationError(
          'Timed out waiting for ARRT results. Ensure the CAPTCHA was solved and the form was submitted.',
          {
            code: AUTOMATION_CODES.CAPTCHA_REQUIRES_APPROVAL,
            retryable: false,
            cause: error,
          }
        );
      }

      const captured = await collectAllResultPages(page, handler, null);

      return {
        html: captured.html,
        url: typeof page.url === 'function' ? page.url() : ARRT_PAGE_URL,
        status: 200,
        fixture: null,
        sourceUrl: ARRT_PAGE_URL,
        captcha: { present: false },
        search,
        pagination: {
          verified: true,
          rowCount: captured.rowCount,
          displayedTotal: captured.displayedTotal,
          source: captured.source,
        },
      };
    } catch (error) {
      onEvent('ERROR', `ARRT search failed: ${error.message}`);
      throw error;
    }
  }

  return {
    id: 'arrt-verify-credentials',
    mode: PROVIDER_MODES.LIVE,
    requiresBrowser: true,
    requiresAuthorization: true,
    requiresCaptchaApproval: true,
    description:
      'Prepared ARRT adapter; live search disabled pending authorization and CAPTCHA approval.',
    observed: ARRT_OBSERVED,
    checkAuthorization,
    analyzePage,
    parseResultsHtml,
    fetchPage,
  };
}

module.exports = {
  ARRT_PAGE_URL,
  ARRT_OBSERVED,
  createArrtAdapter,
  collectAllResultPages,
  readDataTableRows,
  tableDataToHtml,
};
