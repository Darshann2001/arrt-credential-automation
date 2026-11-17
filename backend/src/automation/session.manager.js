'use strict';

/**
 * Session lifecycle bookkeeping.
 *
 * The session manager owns a browser process only when a browser service is
 * supplied. It does not persist cookies, alter identity, or reuse a session to
 * evade access controls.
 */

const { AUTOMATION_CODES, AutomationError } = require('./errors');

let sessionCounter = 0;

/**
 * @param {object} [options]
 * @param {object|null} [options.browserService]
 * @param {(() => Promise<object>)|null} [options.pageFactory]
 * @param {() => number} [options.now]
 */
function createSessionManager(options = {}) {
  const browserService = options.browserService || null;
  const pageFactory =
    typeof options.pageFactory === 'function' ? options.pageFactory : null;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  const id = `session-${++sessionCounter}`;
  let status = 'idle';
  let startedAt = null;
  let closedAt = null;
  let pagesOpened = 0;
  let requestCount = 0;
  let lastRequestAt = null;
  let stopReason = null;

  async function start() {
    if (status === 'active') {
      return snapshot();
    }

    if (status === 'closed') {
      throw new AutomationError('A closed session cannot be restarted.', {
        code: AUTOMATION_CODES.INVALID_OPTIONS,
        details: { sessionId: id },
      });
    }

    status = 'active';
    startedAt = new Date(now()).toISOString();

    return snapshot();
  }

  async function getPage() {
    if (status !== 'active') {
      throw new AutomationError('Session must be active before opening a page.', {
        code: AUTOMATION_CODES.INVALID_OPTIONS,
        details: { sessionId: id, status },
      });
    }

    if (pageFactory) {
      pagesOpened += 1;
      return pageFactory();
    }

    if (!browserService) {
      throw new AutomationError(
        'No browser service or page factory is configured for this session.',
        {
          code: AUTOMATION_CODES.BROWSER_UNAVAILABLE,
          details: { sessionId: id },
        }
      );
    }

    pagesOpened += 1;
    return browserService.newPage();
  }

  function recordRequest(details = {}) {
    requestCount += 1;
    lastRequestAt = details.timestamp || new Date(now()).toISOString();
    return snapshot();
  }

  async function stop(reason = null) {
    stopReason = reason;
    return snapshot();
  }

  async function close() {
    if (status === 'closed') {
      return snapshot();
    }

    status = 'closed';
    closedAt = new Date(now()).toISOString();

    if (browserService && typeof browserService.close === 'function') {
      await browserService.close();
    }

    return snapshot();
  }

  function snapshot() {
    return {
      id,
      status,
      startedAt,
      closedAt,
      pagesOpened,
      requestCount,
      lastRequestAt,
      stopReason,
      browserOwned: Boolean(browserService),
    };
  }

  return {
    id,
    start,
    getPage,
    recordRequest,
    stop,
    close,
    snapshot,
  };
}

module.exports = {
  createSessionManager,
};
