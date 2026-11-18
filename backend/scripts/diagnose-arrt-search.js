#!/usr/bin/env node
'use strict';

/**
 * Interactive ARRT search diagnostic.
 *
 * Opens a visible Chrome window, fills the first/last name fields, and waits for
 * the operator to solve the reCAPTCHA and submit the form by hand. Once real
 * results appear it dumps the response HTML, parsed rows and pagination markup
 * to a git-ignored debug folder for inspection.
 *
 * This script never solves, reads, injects or stores a CAPTCHA token, and it
 * performs no stealth, fingerprinting or proxy rotation. It performs exactly
 * one search and writes nothing to the database.
 *
 * Usage:
 *   npm run diag:search -- --first chris --last adam
 *   npm run diag:search -- --first a --last risk-adams
 */

const fs = require('node:fs');
const path = require('node:path');

const cheerio = require('cheerio');

const { createBrowserService } = require('../src/automation/browser.service');
const { createPageHandler } = require('../src/automation/page-handler');
const { ARRT_PAGE_URL, ARRT_OBSERVED } = require('../src/automation/arrt.adapter');

const DEBUG_DIR = path.join(__dirname, '..', '.debug');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.LIVE_BROWSER_EXECUTABLE_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const PAGINATION_SELECTORS = [
  '.dataTables_paginate',
  '.dataTables_info',
  '.pagination',
  '#searchList_paginate',
  '#searchList_info',
  '.paginate_button',
  '[class*="pagina"]',
  'a[href*="page"]',
];

function parseArgs(argv) {
  const args = {
    first: 'chris',
    last: 'adam',
    waitMs: 300000,
    executable: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--first') args.first = valueAt(argv, ++index, arg);
    else if (arg === '--last') args.last = valueAt(argv, ++index, arg);
    else if (arg === '--wait') args.waitMs = Number(valueAt(argv, ++index, arg));
    else if (arg === '--executable') args.executable = valueAt(argv, ++index, arg);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 1000) {
    throw new Error('--wait must be an integer >= 1000 ms');
  }
  return args;
}

function valueAt(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function resolveExecutable(explicit) {
  const candidates = explicit
    ? [explicit, ...CHROME_CANDIDATES]
    : CHROME_CANDIDATES;
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('No Chrome executable found. Pass --executable <path>.');
  return found;
}

/** Analyze the real result page and return a compact, human-readable summary. */
function analyze(html) {
  const $ = cheerio.load(html, null, false);

  const tables = $('table')
    .toArray()
    .map((table, index) => {
      const headerCells = $(table)
        .find('tr')
        .first()
        .find('th, td')
        .toArray()
        .map((cell) => clean($(cell).text()))
        .filter(Boolean);
      const rows = $(table)
        .find('tr')
        .toArray()
        .slice(1)
        .map((row) =>
          $(row)
            .find('td, th')
            .toArray()
            .map((cell) => clean($(cell).text()))
        )
        .filter((cells) => cells.some(Boolean));
      return { index, headerCells, rowCount: rows.length, sampleRows: rows.slice(0, 12) };
    });

  const pagination = [];
  const seen = new Set();
  for (const selector of PAGINATION_SELECTORS) {
    $(selector).toArray().forEach((el) => {
      const markup = cleanOuterHtml($, el);
      if (!markup || seen.has(markup)) return;
      seen.add(markup);
      pagination.push({ selector, markup });
    });
  }

  const searchListEl = $(ARRT_OBSERVED.selectors.results).first();

  return {
    title: clean($('title').first().text()),
    finalUrl: null, // filled by caller
    searchListFound: searchListEl.length > 0,
    searchListMarkup: searchListEl.length
      ? cleanOuterHtml($, searchListEl.get(0)).slice(0, 20000)
      : null,
    tableCount: tables.length,
    tables,
    pagination,
    bodyTextSample: clean($('body').text()).slice(0, 3000),
  };
}

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanOuterHtml($, el) {
  const clone = $(el).clone();
  clone.find('script').remove();
  return clean(clone.html() ? `<${el.tagName}>${clone.html()}</${el.tagName}>` : $.html(el));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run diag:search -- --first <text> --last <text> [--wait <ms>]');
    return 0;
  }

  const executablePath = resolveExecutable(args.executable);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlFile = path.join(DEBUG_DIR, `arrt-search-${stamp}.html`);
  const jsonFile = path.join(DEBUG_DIR, `arrt-search-${stamp}.json`);
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const browser = createBrowserService({
    headless: false,
    moduleName: 'puppeteer-core',
    launchOptions: { executablePath },
  });

  let page = null;
  try {
    page = await browser.newPage();
    const handler = createPageHandler({ page, timeoutMs: 60000 });

    console.log('Opening ARRT verify page in visible Chrome...');
    await handler.goto(ARRT_PAGE_URL);
    await page.waitForSelector(ARRT_OBSERVED.selectors.firstName, { visible: true });
    await page.waitForSelector(ARRT_OBSERVED.selectors.lastName, { visible: true });

    await page.$eval(ARRT_OBSERVED.selectors.firstName, (el) => { el.value = ''; });
    await page.$eval(ARRT_OBSERVED.selectors.lastName, (el) => { el.value = ''; });
    await handler.fill(ARRT_OBSERVED.selectors.firstName, args.first);
    await handler.fill(ARRT_OBSERVED.selectors.lastName, args.last);

    const captcha = await handler.detectCaptcha();
    console.log('\n============================================================');
    console.log(`First name: "${args.first}"   Last name: "${args.last}"`);
    console.log(captcha.present
      ? 'reCAPTCHA detected. SOLVE IT AND CLICK SEARCH in the Chrome window.'
      : 'Click SEARCH in the Chrome window.');
    console.log(`Waiting up to ${Math.round(args.waitMs / 1000)}s for results...`);
    console.log('============================================================\n');

    let timedOut = false;
    try {
      await handler.waitForResults(ARRT_OBSERVED.selectors.results, args.waitMs);
      console.log('Results detected. Capturing page...');
    } catch (error) {
      timedOut = true;
      console.log(`No results detected before timeout (${error.message}). Capturing page anyway...`);
    }

    const html = await handler.content();
    const summary = analyze(html);
    summary.finalUrl = typeof page.url === 'function' ? page.url() : ARRT_PAGE_URL;
    summary.query = { firstName: args.first, lastName: args.last };
    summary.timedOut = timedOut;
    summary.generatedAt = new Date().toISOString();

    fs.writeFileSync(htmlFile, html, 'utf8');
    fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2), 'utf8');

    console.log('\n--- SUMMARY ---');
    console.log(JSON.stringify({
      query: summary.query,
      timedOut: summary.timedOut,
      searchListFound: summary.searchListFound,
      tableCount: summary.tableCount,
      tables: summary.tables.map((t) => ({
        index: t.index,
        headers: t.headerCells,
        rowCount: t.rowCount,
        sampleRows: t.sampleRows.slice(0, 3),
      })),
      paginationMatches: summary.pagination.length,
    }, null, 2));
    console.log(`\nFull HTML : ${htmlFile}`);
    console.log(`Summary   : ${jsonFile}`);
    return 0;
  } finally {
    if (page && typeof page.close === 'function') await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { analyze, parseArgs };

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error('DIAGNOSTIC_ERROR', error?.code || 'UNEXPECTED_ERROR', error.message);
      process.exitCode = 1;
    });
}
