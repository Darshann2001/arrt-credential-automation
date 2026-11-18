'use strict';

/**
 * Thin page interaction layer.
 *
 * This module performs ordinary page actions (navigate, fill, click, read HTML)
 * and detects CAPTCHA presence. It does not solve CAPTCHAs, read or inject
 * reCAPTCHA tokens, alter browser fingerprints, or hide automation signals.
 */

const cheerio = require('cheerio');

const { AUTOMATION_CODES, AutomationError, invalidOption } = require('./errors');

/**
 * Detects common CAPTCHA widgets from static HTML.
 *
 * @param {string} html
 * @param {object} [context]
 * @param {string|null} [context.url]
 * @returns {object}
 */
function detectCaptchaInHtml(html, context = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    return {
      present: false,
      provider: null,
      type: null,
      siteKey: null,
      url: context.url ?? null,
      evidence: [],
    };
  }

  const $ = cheerio.load(html);
  const evidence = [];
  const recaptchaDiv = $('.g-recaptcha, [data-sitekey]').first();
  const recaptchaScript = $('script[src*="recaptcha"]').first();
  const hcaptchaDiv = $('.h-captcha').first();
  const turnstileDiv = $('.cf-turnstile').first();
  const challengeScript = $(
    'script[src*="challenges.cloudflare.com"], script[src*="hcaptcha.com"]'
  ).first();

  if (recaptchaDiv.length > 0 || recaptchaScript.length > 0) {
    const siteKey =
      recaptchaDiv.attr('data-sitekey') ||
      $('[data-sitekey]').first().attr('data-sitekey') ||
      null;
    const size = recaptchaDiv.attr('data-size') || null;
    const callback = recaptchaDiv.attr('data-callback') || null;

    if (recaptchaScript.length > 0) {
      evidence.push(`script:${recaptchaScript.attr('src')}`);
    }
    if (recaptchaDiv.length > 0) {
      evidence.push('element:.g-recaptcha');
    }
    if (siteKey) {
      evidence.push('attribute:data-sitekey');
    }
    if (size) {
      evidence.push(`attribute:data-size=${size}`);
    }

    return {
      present: true,
      provider: 'google-recaptcha',
      type:
        size === 'invisible'
          ? 'reCAPTCHA v2 invisible'
          : 'reCAPTCHA v2 checkbox',
      siteKey,
      callback,
      url: context.url ?? null,
      requiresInteraction: size !== 'invisible',
      evidence,
    };
  }

  if (hcaptchaDiv.length > 0 || challengeScript.length > 0) {
    return {
      present: true,
      provider: 'hcaptcha',
      type: 'hCaptcha widget',
      siteKey: hcaptchaDiv.attr('data-sitekey') || null,
      callback: hcaptchaDiv.attr('data-callback') || null,
      url: context.url ?? null,
      requiresInteraction: true,
      evidence: ['hCaptcha or challenge script detected'],
    };
  }

  if (turnstileDiv.length > 0) {
    return {
      present: true,
      provider: 'cloudflare-turnstile',
      type: 'Cloudflare Turnstile',
      siteKey: turnstileDiv.attr('data-sitekey') || null,
      callback: turnstileDiv.attr('data-callback') || null,
      url: context.url ?? null,
      requiresInteraction: true,
      evidence: ['element:.cf-turnstile'],
    };
  }

  return {
    present: false,
    provider: null,
    type: null,
    siteKey: null,
    url: context.url ?? null,
    evidence,
  };
}

/**
 * Reads an HTTP status from a Puppeteer response object.
 *
 * @param {object|null} response
 * @returns {number|null}
 */
function readResponseStatus(response) {
  if (!response || typeof response.status !== 'function') {
    return null;
  }

  const status = response.status();
  return Number.isInteger(status) ? status : null;
}

/**
 * @param {object} options
 * @param {object} options.page Puppeteer-compatible page.
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs=30000]
 */
function createPageHandler(options = {}) {
  const page = options.page;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const defaultTimeoutMs = readPositiveInteger(
    options.timeoutMs,
    30000,
    'timeoutMs'
  );

  if (!page || typeof page !== 'object') {
    throw new AutomationError('createPageHandler requires a page object.', {
      code: AUTOMATION_CODES.INVALID_OPTIONS,
      details: { field: 'page', value: typeof page },
    });
  }

  async function goto(url, gotoOptions = {}) {
    if (typeof page.goto !== 'function') {
      throw new AutomationError('Page object does not implement goto().', {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      });
    }

    const timeoutMs = readPositiveInteger(
      gotoOptions.timeoutMs,
      defaultTimeoutMs,
      'timeoutMs'
    );
    const startedAt = now();

    try {
      const response = await page.goto(url, {
        timeout: timeoutMs,
        waitUntil: gotoOptions.waitUntil || 'domcontentloaded',
      });

      return {
        status: readResponseStatus(response),
        durationMs: Math.max(0, now() - startedAt),
        url: typeof page.url === 'function' ? page.url() : url,
      };
    } catch (error) {
      if (error && typeof error === 'object') {
        error.durationMs = Math.max(0, now() - startedAt);
        error.phase = 'goto';
        error.url = url;
      }
      throw error;
    }
  }

  async function content() {
    if (typeof page.content !== 'function') {
      throw new AutomationError('Page object does not implement content().', {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      });
    }

    return page.content();
  }

  async function readHtml(selector) {
    if (selector && typeof page.$eval === 'function') {
      return page.$eval(selector, (element) => element.outerHTML);
    }

    return content();
  }

  async function fill(selector, value) {
    if (typeof page.click !== 'function' || typeof page.type !== 'function') {
      throw new AutomationError(
        'Page object does not implement click()/type().',
        { code: AUTOMATION_CODES.PROVIDER_CONTRACT }
      );
    }

    await page.click(selector);
    await page.type(selector, String(value));
  }

  async function click(selector) {
    if (typeof page.click !== 'function') {
      throw new AutomationError('Page object does not implement click().', {
        code: AUTOMATION_CODES.PROVIDER_CONTRACT,
      });
    }

    await page.click(selector);
  }

  async function waitForSelector(selector, waitOptions = {}) {
    if (typeof page.waitForSelector !== 'function') {
      throw new AutomationError(
        'Page object does not implement waitForSelector().',
        { code: AUTOMATION_CODES.PROVIDER_CONTRACT }
      );
    }

    const timeoutMs = readPositiveInteger(
      waitOptions.timeoutMs,
      defaultTimeoutMs,
      'timeoutMs'
    );

    return page.waitForSelector(selector, { timeout: timeoutMs });
  }

  async function detectCaptcha() {
    const html = await content();
    return detectCaptchaInHtml(html, {
      url: typeof page.url === 'function' ? page.url() : null,
    });
  }

  /**
   * Waits until a results container is actually populated (a result table or an
   * explicit "no results" message), not merely present in the DOM. Used for the
   * supervised flow so the visible browser stays open while the operator solves
   * the CAPTCHA and submits the form. Never reads or injects a CAPTCHA token.
   */
  async function waitForResults(selector, timeoutMs = defaultTimeoutMs) {
    const predicate = (target) => {
      const el = document.querySelector(target);
      if (!el) return false;
      const text = (el.textContent || '').trim();
      if (/no\s+results|no\s+matching|0\s+records/i.test(text)) return true;
      if (el.querySelector('table')) return true;
      if (el.querySelector('tr td')) return true;
      return false;
    };

    if (typeof page.waitForFunction === 'function') {
      await page.waitForFunction(predicate, { timeout: timeoutMs }, selector);
      return;
    }

    // Fallback for minimal page doubles used in tests: poll the HTML directly.
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const html = await content();
      const $ = cheerio.load(html);
      const el = $(selector);
      const text = el.text().trim();
      if (
        el.find('table').length > 0 ||
        el.find('tr td').length > 0 ||
        /no\s+results|no\s+matching|0\s+records/i.test(text)
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new AutomationError('Timed out waiting for ARRT results to appear.', {
      code: AUTOMATION_CODES.PROVIDER_ERROR,
      retryable: false,
      details: { selector, timeoutMs },
    });
  }

  return {
    page,
    goto,
    content,
    readHtml,
    fill,
    click,
    waitForSelector,
    waitForResults,
    detectCaptcha,
    detectCaptchaInHtml,
  };
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw invalidOption(name, 'must be a positive integer', value);
  }

  return value;
}

module.exports = {
  detectCaptchaInHtml,
  readResponseStatus,
  createPageHandler,
};
