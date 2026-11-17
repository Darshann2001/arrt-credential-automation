'use strict';

/**
 * Lazy Puppeteer lifecycle wrapper.
 *
 * Puppeteer is intentionally NOT a dependency of this phase. `launch()` loads it
 * lazily and returns a descriptive BROWSER_UNAVAILABLE error when it is absent.
 *
 * No stealth plugins, fingerprint spoofing, automation-hiding flags, proxy
 * rotation or custom evasion headers are applied here. Callers may pass normal
 * Puppeteer launch options (for example an approved executablePath).
 */

const { AUTOMATION_CODES, AutomationError } = require('./errors');

/**
 * @param {object} [options]
 * @param {boolean} [options.headless=true]
 * @param {object} [options.launchOptions]
 * @param {string} [options.moduleName='puppeteer']
 * @param {object|null} [options.puppeteerModule] Test/integration injection point.
 */
function createBrowserService(options = {}) {
  const headless = options.headless !== false;
  const launchOptions = options.launchOptions || {};
  const moduleName = options.moduleName || 'puppeteer';
  const injectedModule = options.puppeteerModule || null;

  let browser = null;
  let launchCount = 0;
  let pageCount = 0;
  let lastLaunchAt = null;
  let lastClosedAt = null;

  async function launch() {
    if (browser) {
      return browser;
    }

    const puppeteer = injectedModule || loadPuppeteer(moduleName);

    browser = await puppeteer.launch({
      ...launchOptions,
      headless,
    });

    launchCount += 1;
    lastLaunchAt = new Date().toISOString();

    return browser;
  }

  async function newPage() {
    const activeBrowser = await launch();
    const page = await activeBrowser.newPage();
    pageCount += 1;
    return page;
  }

  async function withPage(handler) {
    if (typeof handler !== 'function') {
      throw new AutomationError('withPage requires a handler function.', {
        code: AUTOMATION_CODES.INVALID_OPTIONS,
        details: { field: 'handler', value: typeof handler },
      });
    }

    const page = await newPage();

    try {
      return await handler(page);
    } finally {
      if (typeof page.close === 'function') {
        await page.close();
      }
    }
  }

  async function close() {
    if (!browser) {
      return false;
    }

    const closing = browser;
    browser = null;
    await closing.close();
    lastClosedAt = new Date().toISOString();

    return true;
  }

  function snapshot() {
    return {
      moduleName,
      available: Boolean(injectedModule) || isModuleAvailable(moduleName),
      launched: browser !== null,
      headless,
      launchCount,
      pageCount,
      lastLaunchAt,
      lastClosedAt,
      stealthApplied: false,
    };
  }

  return { launch, newPage, withPage, close, snapshot };
}

function loadPuppeteer(moduleName) {
  try {
    // Deliberately lazy: the investigation phase must not require a browser.
    return require(moduleName);
  } catch (error) {
    throw new AutomationError(
      `Puppeteer is not installed ("${moduleName}"). Install it only after authorization and browser-automation approval.`,
      {
        code: AUTOMATION_CODES.BROWSER_UNAVAILABLE,
        retryable: false,
        cause: error,
        details: {
          remediation:
            'Install an approved Puppeteer version, or inject a compatible module for tests.',
        },
      }
    );
  }
}

function isModuleAvailable(moduleName) {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createBrowserService,
};
