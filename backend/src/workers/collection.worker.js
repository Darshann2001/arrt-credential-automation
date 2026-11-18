'use strict';

/**
 * Thin supervised collection worker.
 *
 * One job at a time. It opens a visible Chrome window, fills a real name-fragment
 * query, waits for the operator to solve the reCAPTCHA and submit, extracts the
 * results with the existing engine, imports them into the DB, then closes the
 * browser. No CAPTCHA solving, token access, stealth or proxy rotation.
 *
 * ARRT does substring matching on real name text. Patterns such as "A*" are
 * treated literally and return no rows, so the plan uses real name fragments
 * that are known to return live results. Each search requires a human CAPTCHA,
 * so the supervised demo intentionally uses a single query.
 */

const { assertLiveCollectionAllowed } = require('../config/env');
const {
  createArrtAdapter,
  ARRT_PAGE_URL,
} = require('../automation/arrt.adapter');
const { createBrowserService } = require('../automation/browser.service');
const { createPageHandler } = require('../automation/page-handler');
const { collectRecords } = require('../automation/collection.service');
/**
 * One high-yield, real name-fragment query per supervised run. ARRT matches
 * substrings anywhere in the name (e.g. "adam" matched Adams, McAdam and
 * Risk-Adams), so a common first/last-name pair returns many rows in a single
 * search and a single CAPTCHA. Wildcards like "A*" are literal text and return
 * nothing.
 *
 * "john" / "smith" are among the most common US first and last names, so this
 * query is expected to return a large result set from one request.
 */
const SUPERVISED_SEARCHES = Object.freeze([
  { firstName: 'john', lastName: 'smith' },
]);

function buildSearchPlan(limit) {
  return SUPERVISED_SEARCHES.slice(0, Math.max(1, Math.min(limit, SUPERVISED_SEARCHES.length)));
}

function createCollectionWorker({ jobRepository, importService, config }) {
  let activeJobId = null;

  function createProvider(approval, log) {
    const browser = createBrowserService({
      headless: approval.browser.headless,
      moduleName: 'puppeteer-core',
      launchOptions: {
        executablePath: approval.browser.executablePath || undefined,
        userDataDir: approval.browser.userDataDir || undefined,
      },
    });

    let page = null;
    let handler = null;

    async function ensurePage() {
      if (!page) {
        page = await browser.newPage();
        handler = createPageHandler({ page, timeoutMs: 60000 });
        await handler.goto(ARRT_PAGE_URL);
        log('INFO', `Opened ARRT verify page in visible Chrome: ${ARRT_PAGE_URL}`);
      }
      return { page, handler };
    }

    const adapter = createArrtAdapter({
      authorization: {
        confirmed: true,
        reference: approval.authorization.reference,
        scope: approval.authorization.scope,
      },
      captcha: {
        approved: true,
        approvalReference: approval.captcha.approvalReference,
      },
      onEvent: log,
      pageFactory: ensurePage,
      captchaWaitMs: 300000,
    });

    return {
      ...adapter,
      async close() {
        await browser.close();
      },
    };
  }

  async function startRun(jobId) {
    if (activeJobId) {
      throw new Error('A collection job is already running.');
    }

    const job = await jobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    if (job.status !== 'PENDING') {
      throw new Error(`Job ${jobId} is ${job.status}, not PENDING.`);
    }

    const approval = assertLiveCollectionAllowed(config);
    const plannedSearches = Math.min(approval.limits.maxSearchesPerJob, 676);
    assertLiveCollectionAllowed(config, {
      requestedTarget: job.requestedTarget,
      plannedSearches,
    });

    activeJobId = jobId;
    const running = await jobRepository.markRunning(job.id);

    void finishRun(job, approval, plannedSearches).finally(() => {
      activeJobId = null;
    });

    return running;
  }

  async function finishRun(job, approval, plannedSearches) {
    const log = (level, message) =>
      jobRepository.appendLog(job.id, level, message).catch(() => {});

    let provider = null;

    try {
      const searchPlan = buildSearchPlan(plannedSearches);
      await log('INFO', `Starting supervised live collection with ${searchPlan.length} real name-fragment search(es).`);

      provider = createProvider(approval, log);
      const result = await collectRecords(searchPlan, {
        provider,
        allowLiveProvider: true,
        authorization: {
          confirmed: true,
          reference: approval.authorization.reference,
        },
        target: { min: 1, max: Math.max(1, job.requestedTarget) },
        stopOnCaptcha: false,
        minIntervalMs: 1000,
        maxRetries: 0,
      });

      // One broad search can return more rows than the configured cap. Enforce
      // the cap here as well so a single response cannot exceed it.
      const recordCap = Math.max(1, job.requestedTarget);
      await importService.importRecords({
        records: result.records.slice(0, recordCap),
        source: job.source,
        jobId: job.id,
      });

      await jobRepository.markCompleted(job.id);
      await log(
        'INFO',
        `Imported ${result.records.length} record(s); collection stopped because ${result.stopReason || 'plan exhausted'}.`
      );
    } catch (error) {
      await jobRepository
        .markFailed(job.id, error && error.message ? error.message : String(error))
        .catch(() => {});
    } finally {
      if (provider && typeof provider.close === 'function') {
        await provider.close().catch(() => {});
      }
    }
  }

  return { startRun, isBusy: () => activeJobId !== null };
}

module.exports = { createCollectionWorker };
