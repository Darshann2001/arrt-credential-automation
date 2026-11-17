#!/usr/bin/env node
'use strict';

/**
 * Standalone, single-page observation of the public ARRT verification page.
 *
 * What this script does:
 *   - opens https://www.arrt.org/pages/verify-credentials once in a normal
 *     Chrome session;
 *   - records form, CAPTCHA, script, cookie-name, timing and network metadata;
 *   - analyses the page's public search widget code without executing a search.
 *
 * What this script deliberately does NOT do:
 *   - fill or submit the search form;
 *   - solve, reset, read or inject a reCAPTCHA token;
 *   - replay requests, change identity, rotate IPs, use proxies or evade access
 *     controls;
 *   - persist cookie, anti-forgery-token or CAPTCHA-response values.
 */

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const TARGET_URL = 'https://www.arrt.org/pages/verify-credentials';
const DEFAULT_OUTPUT = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'evidence',
  'arrt-page-observation.json'
);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const SAFE_HEADER_NAMES = new Set([
  'cache-control',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-type',
  'date',
  'permissions-policy',
  'referrer-policy',
  'server',
  'strict-transport-security',
  'vary',
  'x-content-type-options',
  'x-frame-options',
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const puppeteer = require('puppeteer-core');
  const executablePath = resolveExecutable(args.executable);
  const outputPath = path.resolve(args.output);
  const timeoutMs = args.timeoutMs;

  const browser = await puppeteer.launch({
    executablePath,
    headless: args.headless,
    defaultViewport: { width: 1366, height: 900 },
  });

  const startedAt = Date.now();
  const network = [];
  const failedRequests = [];
  const responseByRequest = new Map();
  let customWidgetBodyPromise = null;
  let mainResponse = null;
  let page = null;

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);

    page.on('response', (response) => {
      const request = response.request();
      const entry = describeResponse(response, request);
      network.push(entry);
      responseByRequest.set(request, entry);

      if (/\/js\/custom\/VerifyCredentialsWidget\.js(?:$|\?)/.test(response.url())) {
        customWidgetBodyPromise = response
          .text()
          .then((body) => body)
          .catch(() => null);
      }
    });

    page.on('requestfailed', (request) => {
      failedRequests.push({
        ...sanitizeUrl(request.url()),
        method: request.method(),
        resourceType: request.resourceType(),
        errorText: request.failure()?.errorText || null,
      });
    });

    mainResponse = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    await page
      .waitForNetworkIdle({ idleTime: 1000, timeout: 15000 })
      .catch(() => {});

    const captchaReady = await page
      .waitForFunction(
        () =>
          typeof window.grecaptcha !== 'undefined' ||
          Boolean(document.querySelector('.g-recaptcha iframe')) ||
          Boolean(document.querySelector('iframe[title*="reCAPTCHA"]')),
        { timeout: 12000 }
      )
      .then(() => true)
      .catch(() => false);

    const dom = await page.evaluate(collectDomFacts);
    const cookies = (await page.cookies()).map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: cookie.sameSite || null,
      session: Boolean(cookie.session),
    }));

    const frames = page.frames().map((frame) => ({
      ...sanitizeUrl(frame.url()),
      name: frame.name() || null,
    }));

    const widgetBody =
      (await customWidgetBodyPromise?.catch(() => null)) || null;
    const widget = analyzeWidgetSource(widgetBody);
    const mainHeaders = mainResponse?.headers() || {};
    const mainEntry = mainResponse
      ? responseByRequest.get(mainResponse.request()) || null
      : null;

    const result = {
      generatedAt: new Date().toISOString(),
      targetUrl: TARGET_URL,
      safety: {
        pageLoads: 1,
        searchSubmitted: false,
        captchaSolved: false,
        tokenValuesRead: false,
        tokenValuesPersisted: false,
        cookieValuesPersisted: false,
        antiForgeryValuesPersisted: false,
        ipEvasionUsed: false,
      },
      browser: {
        executablePath,
        headless: args.headless,
        product: await browser.version(),
      },
      navigation: {
        finalUrl: page.url(),
        title: await page.title(),
        status: mainResponse?.status() ?? null,
        durationMs: Date.now() - startedAt,
        timing: dom.navigationTiming,
      },
      response: {
        contentType: mainHeaders['content-type'] || null,
        contentLength: mainHeaders['content-length'] || null,
        headerNames: Object.keys(mainHeaders).sort(),
        safeHeaders: selectSafeHeaders(mainHeaders),
        rateLimitHeaders: selectRateLimitHeaders(mainHeaders),
      },
      form: dom.form,
      captcha: {
        ...dom.captcha,
        captchaReady,
        frames: frames.filter((frame) => /recaptcha/i.test(frame.origin || '')),
      },
      page: dom.page,
      cookies: {
        count: cookies.length,
        names: cookies.map((cookie) => cookie.name),
        attributes: cookies,
        valuesPersisted: false,
      },
      scripts: dom.scripts,
      widgetSource: widget,
      network: {
        count: network.length,
        byResourceType: countBy(network, 'resourceType'),
        byOrigin: countBy(network, (entry) => entry.origin || '(none)'),
        responses: network,
        failedRequests,
      },
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

    console.log(
      JSON.stringify(
        {
          output: outputPath,
          finalUrl: result.navigation.finalUrl,
          title: result.navigation.title,
          status: result.navigation.status,
          formFound: result.form.found,
          captchaFound: result.captcha.found,
          captchaType: result.captcha.inferredType,
          antiForgeryPresent: result.form.antiForgery.present,
          searchListFound: result.page.searchList.found,
          tablesFound: result.page.tables.count,
          networkResponses: result.network.count,
          failedRequests: failedRequests.length,
          widgetSourceObserved: result.widgetSource.observed,
          durationMs: result.navigation.durationMs,
        },
        null,
        2
      )
    );
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

function collectDomFacts() {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const round = (value) =>
    Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  const attr = (element, name) =>
    element && element.hasAttribute(name) ? element.getAttribute(name) : null;
  const inputFacts = (input) => ({
    id: input.id || null,
    name: input.name || null,
    type: input.type || null,
    minLength: input.minLength > 0 ? input.minLength : null,
    maxLength: input.maxLength > 0 ? input.maxLength : null,
    required: Boolean(input.required),
    disabled: Boolean(input.disabled),
    hidden: input.type === 'hidden',
    valuePresent: Boolean(input.value),
    valueLength: input.value.length,
    autocomplete: attr(input, 'autocomplete'),
    validationAttributes: {
      'data-val': attr(input, 'data-val'),
      'data-val-required': attr(input, 'data-val-required'),
      'data-valmsg-for': attr(input, 'data-valmsg-for'),
    },
  });

  const formElement = document.querySelector('#searchForm');
  const formInputs = formElement
    ? Array.from(formElement.querySelectorAll('input')).map(inputFacts)
    : [];
  const antiForgeryElement = document.querySelector(
    'input[name="__RequestVerificationToken"]'
  );
  const captchaElement = document.querySelector('.g-recaptcha, [data-sitekey]');
  const captchaIframes = Array.from(
    document.querySelectorAll('.g-recaptcha iframe, iframe[title*="reCAPTCHA"]')
  ).map((iframe) => {
    const facts = {
      title: iframe.title || null,
      origin: null,
      path: null,
      queryKeys: [],
      size: null,
    };

    try {
      const url = new URL(iframe.src);
      facts.origin = url.origin;
      facts.path = url.pathname;
      facts.queryKeys = Array.from(url.searchParams.keys()).sort();
      facts.size = url.searchParams.get('size');
    } catch {
      // Leave unresolved iframe sources unreported.
    }

    return facts;
  });

  const scripts = Array.from(document.scripts).map((script) => {
    const source = script.src || '';
    const inline = script.src ? '' : script.textContent || '';
    return {
      src: script.src || null,
      async: Boolean(script.async),
      defer: Boolean(script.defer),
      inlineLength: inline.length,
      inlineHasSearchEndpoint: inline.includes(
        '/VerifyCredentials/SearchByName'
      ),
      inlineHasDetailsEndpoint: inline.includes(
        '/VerifyCredentials/GetDisplayDetails'
      ),
      inlineHasDataTableInitialization:
        /\.DataTable\s*\(|\.dataTable\s*\(/.test(inline),
      path: source ? new URL(source, location.href).pathname : null,
    };
  });

  const searchList = document.querySelector('#searchList');
  const tables = Array.from(document.querySelectorAll('table')).map((table) => ({
    id: table.id || null,
    headers: Array.from(table.querySelectorAll('th')).map((th) => clean(th.textContent)),
    rows: table.querySelectorAll('tbody tr').length,
  }));
  const navEntry = performance.getEntriesByType('navigation')[0] || null;
  const resources = performance.getEntriesByType('resource');
  const jquery = window.jQuery || null;
  const dataTables =
    jquery && jquery.fn && jquery.fn.dataTable ? jquery.fn.dataTable : null;

  return {
    navigationTiming: navEntry
      ? {
          type: navEntry.type,
          redirectCount: navEntry.redirectCount,
          dnsMs: round(navEntry.domainLookupEnd - navEntry.domainLookupStart),
          connectMs: round(navEntry.connectEnd - navEntry.connectStart),
          tlsMs: navEntry.secureConnectionStart
            ? round(navEntry.connectEnd - navEntry.secureConnectionStart)
            : null,
          requestMs: round(navEntry.responseStart - navEntry.requestStart),
          responseMs: round(navEntry.responseEnd - navEntry.responseStart),
          domContentLoadedMs: round(
            navEntry.domContentLoadedEventEnd - navEntry.startTime
          ),
          loadMs: round(navEntry.loadEventEnd - navEntry.startTime),
          transferSize: navEntry.transferSize,
          encodedBodySize: navEntry.encodedBodySize,
          decodedBodySize: navEntry.decodedBodySize,
          resourceCount: resources.length,
        }
      : null,
    form: {
      found: Boolean(formElement),
      id: formElement?.id || null,
      method: formElement?.method || null,
      actionAttribute: attr(formElement, 'action'),
      actionResolved: formElement?.action || null,
      inputs: formInputs,
      submitButtons: formElement
        ? Array.from(formElement.querySelectorAll('[type="submit"]')).map((button) => ({
            id: button.id || null,
            value: attr(button, 'value'),
            className: attr(button, 'class'),
          }))
        : [],
      antiForgery: {
        selector: 'input[name="__RequestVerificationToken"]',
        present: Boolean(antiForgeryElement),
        type: antiForgeryElement?.type || null,
        valuePresent: Boolean(antiForgeryElement?.value),
        valueLength: antiForgeryElement?.value?.length || 0,
        insideSearchForm: Boolean(
          antiForgeryElement && formElement?.contains(antiForgeryElement)
        ),
        valuesPersisted: false,
      },
    },
    captcha: {
      found: Boolean(captchaElement),
      selector: '.g-recaptcha',
      provider: captchaElement ? 'google-recaptcha' : null,
      siteKey: attr(captchaElement, 'data-sitekey'),
      dataSize: attr(captchaElement, 'data-size'),
      dataCallback: attr(captchaElement, 'data-callback'),
      dataTheme: attr(captchaElement, 'data-theme'),
      inferredType: captchaElement
        ? attr(captchaElement, 'data-size') === 'invisible'
          ? 'reCAPTCHA v2 invisible'
          : 'reCAPTCHA v2 checkbox'
        : null,
      scriptUrls: scripts
        .filter((script) => /recaptcha/i.test(script.src || ''))
        .map((script) => script.src),
      grecaptchaGlobalPresent: typeof window.grecaptcha !== 'undefined',
      grecaptchaMethods: {
        getResponse: Boolean(window.grecaptcha?.getResponse),
        reset: Boolean(window.grecaptcha?.reset),
        execute: Boolean(window.grecaptcha?.execute),
      },
      recaptchaConfigClientCount:
        window.___grecaptcha_cfg?.clients &&
        typeof window.___grecaptcha_cfg.clients === 'object'
          ? Object.keys(window.___grecaptcha_cfg.clients).length
          : null,
      iframes: captchaIframes,
    },
    page: {
      heading: clean(document.querySelector('h1')?.textContent),
      endpoints: {
        searchByName:
          window.VerifyCredentialsSearchByNameUrl ||
          window.VerifyCredentialsSearchByNameUrl === ''
            ? window.VerifyCredentialsSearchByNameUrl
            : null,
        displayDetails:
          window.VerifyCredentialsGetDisplayDetailsUrl ||
          window.VerifyCredentialsGetDisplayDetailsUrl === ''
            ? window.VerifyCredentialsGetDisplayDetailsUrl
            : null,
      },
      searchList: {
        found: Boolean(searchList),
        childElementCount: searchList?.childElementCount || 0,
        textLength: clean(searchList?.textContent).length,
        htmlLength: searchList?.innerHTML?.length || 0,
      },
      detailsModal: {
        found: Boolean(document.querySelector('#divDetailsModal')),
        contentFound: Boolean(document.querySelector('#divDetailsModalContent')),
      },
      libraries: {
        jqueryVersion: jquery?.fn?.jquery || null,
        dataTablesVersion: dataTables?.version || null,
        dataTablesWrappers: document.querySelectorAll('.dataTables_wrapper').length,
        dataTablesPaginate: document.querySelectorAll('.dataTables_paginate').length,
        dataTablesButtons: document.querySelectorAll('.dt-button').length,
        genericPagination: document.querySelectorAll('.pagination').length,
      },
      tables: {
        count: tables.length,
        items: tables,
      },
      bodyTextLength: clean(document.body?.textContent).length,
    },
    scripts: {
      count: scripts.length,
      dataTableInitializationObserved: scripts.some(
        (script) => script.inlineHasDataTableInitialization
      ),
      items: scripts,
    },
  };
}

function analyzeWidgetSource(body) {
  if (typeof body !== 'string' || !body.trim()) {
    return {
      observed: false,
      sourceLength: 0,
      note: 'Public widget source was not captured during the page load.',
    };
  }

  const bodyFieldMatches = Array.from(
    body.matchAll(/\b(firstName|lastName|captchaSuccessCode|key)\s*:/g)
  ).map((match) => match[1]);

  return {
    observed: true,
    sourceLength: body.length,
    usesFormSubmitHandler: /#searchForm/.test(body) && /\.submit\s*\(/.test(body),
    clientMinLengths: {
      lastName: /lastname[^\n]*\.length\s*<\s*2/.test(body) ? 2 : null,
      firstName: /firstname[^\n]*\.length\s*<\s*1/.test(body) ? 1 : null,
    },
    readsCaptchaResponse: /grecaptcha\.getResponse\s*\(/.test(body),
    checksEmptyCaptchaResponse: /captchaResponse\s*==\s*['"]{2}/.test(body),
    resetsCaptchaOnSuccess: /grecaptcha\.reset\s*\(/.test(body),
    postsSearchRequest: /VerifyCredentialsSearchByNameUrl/.test(body),
    postsDetailsRequest: /VerifyCredentialsGetDisplayDetailsUrl/.test(body),
    method: /\btype\s*:\s*['"]POST['"]/i.test(body) ? 'POST' : null,
    contentTypeOptionPresent: /\bcontentType\s*:/.test(body),
    dataTypeOptionPresent: /\bdataType\s*:/.test(body),
    datatypeLowercaseOptionPresent: /\bdatatype\s*:/.test(body),
    antiForgeryHeader: /RequestVerificationToken/.test(body)
      ? 'RequestVerificationToken'
      : null,
    bodyFields: Array.from(new Set(bodyFieldMatches)).sort(),
    insertsHtmlResult: /\.html\s*\(\s*result\s*\)/.test(body),
    handlesHttp424AsCaptchaFailure: /\bstatus\s*==\s*424\b/.test(body),
    hasGenericErrorBranch: /Failed to load Verify Credential Widget/.test(body),
    dataTableInitialization: /\.DataTable\s*\(|\.dataTable\s*\(/.test(body),
    paginationLogic: /\bpagination\b|\bpaginate\b|\bpageLength\b|\bpageSize\b/.test(
      body
    ),
  };
}

function describeResponse(response, request) {
  const headers = response.headers();
  return {
    ...sanitizeUrl(response.url()),
    method: request.method(),
    resourceType: request.resourceType(),
    status: response.status(),
    contentType: headers['content-type'] || null,
    contentLength: headers['content-length'] || null,
    fromCache: response.fromCache(),
    safeHeaders: selectSafeHeaders(headers),
    rateLimitHeaders: selectRateLimitHeaders(headers),
  };
}

function selectSafeHeaders(headers) {
  const selected = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (SAFE_HEADER_NAMES.has(name.toLowerCase())) {
      selected[name.toLowerCase()] = value;
    }
  }
  return selected;
}

function selectRateLimitHeaders(headers) {
  const selected = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (
      lower === 'retry-after' ||
      lower.includes('ratelimit') ||
      lower.includes('rate-limit') ||
      lower === 'x-request-id' ||
      lower === 'request-id'
    ) {
      selected[lower] = value;
    }
  }
  return selected;
}

function sanitizeUrl(value) {
  if (typeof value !== 'string' || !value) {
    return { origin: null, path: null, queryKeys: [] };
  }

  if (/^data:/i.test(value)) {
    const comma = value.indexOf(',');
    return {
      origin: 'data:',
      path: null,
      queryKeys: [],
      dataUri: {
        meta: comma > 0 ? value.slice(0, comma) : value.slice(0, 32),
        length: value.length,
      },
    };
  }

  try {
    const url = new URL(value);
    return {
      origin: url.origin,
      path: url.pathname,
      queryKeys: Array.from(url.searchParams.keys()).sort(),
    };
  } catch {
    return { origin: null, path: value.split('?')[0], queryKeys: [] };
  }
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = typeof key === 'function' ? key(item) : item[key];
    const label = value || '(none)';
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function resolveExecutable(explicitPath) {
  const candidates = explicitPath ? [explicitPath, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));

  if (!found) {
    throw new Error(
      'No Chrome/Edge executable found. Set CHROME_PATH or pass --executable <path>.'
    );
  }

  return found;
}

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    headless: false,
    timeoutMs: 45000,
    executable: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headless') {
      args.headless = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--output') {
      args.output = readValue(argv, ++index, '--output');
    } else if (arg === '--executable') {
      args.executable = readValue(argv, ++index, '--executable');
    } else if (arg === '--timeout') {
      args.timeoutMs = Number(readValue(argv, ++index, '--timeout'));
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) {
        throw new Error('--timeout must be an integer number of milliseconds >= 1000.');
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/inspect-arrt-page.js [options]

Options:
  --headless              Run Chrome headless (default: visible browser)
  --output <path>         JSON evidence output path
  --executable <path>     Chrome/Edge executable path
  --timeout <ms>          Navigation/action timeout (default: 45000)
  --help, -h              Show this help

The script loads the public page once and never submits a search and never
persists a CAPTCHA, anti-forgery or cookie value.`);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error?.message || String(error),
        code: error?.code || null,
        note: 'No search was submitted and no token or cookie value was persisted.',
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
