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

// The result list is a client-side DataTables grid. Only the current page's rows
// are in the DOM, so we widen the page size and then follow "Next" until the
// total reported by #grid_info has been captured. All of this is ordinary UI
// interaction on the already-submitted page; no CAPTCHA token is touched.
const RESULTS_TABLE_ID = 'grid';
const RESULTS_INFO_ID = 'grid_info';
const RESULTS_NEXT_ID = 'grid_next';
const RESULTS_LENGTH_SELECTOR = '#grid_length';
const MAX_RESULT_PAGES = 100;

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
 * Reads the current DataTables page state from the live page.
 * Returns null on page doubles that cannot run evaluate(), in which case
 * pagination is skipped and the caller keeps the single captured page.
 */
async function readResultPageState(page) {
  if (typeof page.evaluate !== 'function') {
    return null;
  }

  return page.evaluate(
    (tableId, infoId, nextId) => {
      const table = document.getElementById(tableId);
      const info = document.getElementById(infoId);
      const next = document.getElementById(nextId);
      const rows = table ? table.querySelectorAll('tbody tr').length : 0;
      const infoText = info
        ? (info.textContent || '').replace(/\s+/g, ' ').trim()
        : '';
      const match = infoText.match(/of\s+(\d+)\s+items/i);

      return {
        rows,
        total: match ? Number(match[1]) : null,
        hasNext: Boolean(next && !next.classList.contains('disabled')),
        infoText,
      };
    },
    RESULTS_TABLE_ID,
    RESULTS_INFO_ID,
    RESULTS_NEXT_ID
  );
}

function pageSignature(state) {
  return state ? `${state.infoText}|${state.rows}` : '';
}

async function waitForTableChange(page, previousSignature, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await readResultPageState(page);
    if (state && pageSignature(state) !== previousSignature) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

/** Merges the rendered rows of every captured page into one parseable table. */
function mergeResultPages(htmlPages) {
  const usable = (htmlPages || []).filter(
    (html) => typeof html === 'string' && html.trim()
  );

  if (usable.length === 0) {
    return '';
  }
  if (usable.length === 1) {
    return usable[0];
  }

  let headerHtml = '';
  const rowParts = [];

  for (const html of usable) {
    const $page = cheerio.load(html, null, false);
    const table = $page(`#${RESULTS_TABLE_ID}`).first().length
      ? $page(`#${RESULTS_TABLE_ID}`).first()
      : $page('table').first();
    if (!table.length) {
      continue;
    }

    if (!headerHtml) {
      const thead = table.find('thead').first();
      const headRows = thead.length
        ? thead.find('tr').toArray()
        : table.find('tr').toArray().slice(0, 1);
      headerHtml = headRows.map((row) => $page.html(row)).join('');
    }

    const tbody = table.find('tbody').first();
    const dataRows = tbody.length
      ? tbody.find('tr').toArray()
      : table.find('tr').toArray().slice(1);
    for (const row of dataRows) {
      rowParts.push($page.html(row));
    }
  }

  if (!rowParts.length) {
    return usable[0];
  }

  return `<table id="${RESULTS_TABLE_ID}"><thead>${headerHtml}</thead><tbody>${rowParts.join('')}</tbody></table>`;
}

/**
 * Captures all result pages for an already-submitted query. First widens the
 * DataTables page size to 100 (one UI action), then follows Next while the
 * reported total exceeds the rows collected so far.
 */
async function collectAllResultPages(page, handler, firstHtml) {
  const htmlPages = [firstHtml];

  if (typeof page.select === 'function') {
    try {
      const before = await readResultPageState(page);
      await page.select(RESULTS_LENGTH_SELECTOR, '100');
      await waitForTableChange(page, pageSignature(before));
      htmlPages.push(await handler.content());
    } catch (error) {
      // The length selector is an optimization; Next-clicking still works.
    }
  }

  for (let pageNumber = 0; pageNumber < MAX_RESULT_PAGES; pageNumber += 1) {
    const before = await readResultPageState(page);
    if (!before || !before.total || before.rows >= before.total || !before.hasNext) {
      break;
    }

    try {
      await handler.click(`#${RESULTS_NEXT_ID}`);
      await waitForTableChange(page, pageSignature(before));
      htmlPages.push(await handler.content());
    } catch (error) {
      break;
    }
  }

  return { html: mergeResultPages(htmlPages), pagesCaptured: htmlPages.length };
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

      const firstHtml = await handler.content();
      const captured = await collectAllResultPages(page, handler, firstHtml);

      return {
        html: captured.html,
        url: typeof page.url === 'function' ? page.url() : ARRT_PAGE_URL,
        status: 200,
        fixture: null,
        sourceUrl: ARRT_PAGE_URL,
        captcha: { present: false },
        search,
        pagination: { pagesCaptured: captured.pagesCaptured },
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
  mergeResultPages,
};
