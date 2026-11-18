'use strict';

/**
 * Thin supervised collection worker.
 *
 * One job at a time. It opens a visible Chrome window, fills a real name-fragment
 * query, waits for the operator to solve the reCAPTCHA and submit, extracts the
 * results with the existing engine, imports them into the DB, then closes the
 * browser. No CAPTCHA solving, token access, stealth or proxy rotation.
 *
 * Each search is processed independently:
 *   - a per-search checkpoint records COMPLETED / FAILED / PENDING state;
 *   - records are imported immediately after a verified search, so an
 *     interruption never loses already-collected rows;
 *   - a resumed job repeats only searches that have not yet succeeded;
 *   - the job is marked COMPLETED only when every planned search succeeded.
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
const {
  STATUS,
} = require('../api/repositories/search-progress.repository');

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
  return SUPERVISED_SEARCHES.slice(
    0,
    Math.max(1, Math.min(limit, SUPERVISED_SEARCHES.length))
  );
}

/**
 * A search counts as successful only when the run completed, at least one page
 * was actually extracted, the extracted counts reconcile, and no page errored.
 * This is deliberately strict: a skipped/captcha-blocked search or a partial
 * grid read must never be persisted as a completed checkpoint.
 *
 * @param {object} result result of collectRecords() for a single search
 * @returns {boolean}
 */
function getPageErrors(result) {
  const stats = (result && result.stats) || {};
  const extraction = stats.extraction || {};
  // collectRecords() nests page errors under stats.extraction.pageErrors.
  // The top-level fallback keeps older/compatible result shapes working.
  return extraction.pageErrors ?? stats.pageErrors ?? [];
}

function searchSucceeded(result) {
  const stats = (result && result.stats) || {};
  const pageErrors = getPageErrors(result);

  return Boolean(
    result &&
      result.status === 'completed' &&
      stats.searchesCompleted >= 1 &&
      stats.countsConsistent === true &&
      Array.isArray(pageErrors) &&
      pageErrors.length === 0
  );
}

/**
 * @param {object} deps
 * @param {object} deps.jobRepository
 * @param {object} deps.importService
 * @param {object} deps.searchProgressRepository
 * @param {object} deps.config
 * @param {Array<{firstName: string, lastName: string}>} [deps.searches] test override
 * @param {Function} [deps.providerFactory] test override for provider creation
 * @param {Function} [deps.collectRecordsImpl] test override for collection
 */
function createCollectionWorker({
  jobRepository,
  importService,
  searchProgressRepository,
  config,
  searches: searchPlanOverride,
  providerFactory,
  collectRecordsImpl = collectRecords,
}) {
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

    // PENDING starts a fresh run. RUNNING is an interrupted process that can be
    // resumed, and FAILED is a run that stopped early. COMPLETED and CANCELLED
    // are terminal and must not be restarted.
    if (!['PENDING', 'RUNNING', 'FAILED'].includes(job.status)) {
      throw new Error(`Job ${jobId} is ${job.status} and cannot be run.`);
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
      const searchPlan =
        Array.isArray(searchPlanOverride) && searchPlanOverride.length > 0
          ? searchPlanOverride
          : buildSearchPlan(plannedSearches);

      // Create checkpoints for the whole plan. Existing rows are preserved so a
      // resumed job never repeats a search that already succeeded.
      await searchProgressRepository.ensureMany(job.id, searchPlan);
      const pending = await searchProgressRepository.listPending(job.id);

      await log(
        'INFO',
        `Starting supervised live collection: ${searchPlan.length} planned search(es), ${pending.length} pending.`
      );

      provider = providerFactory
        ? providerFactory(approval, log)
        : createProvider(approval, log);

      for (const checkpoint of pending) {
        const search = {
          firstName: checkpoint.firstName,
          lastName: checkpoint.lastName,
        };

        await searchProgressRepository.markRunning(checkpoint.id);

        try {
          const result = await collectRecordsImpl([search], {
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

          if (!searchSucceeded(result)) {
            const reason =
              result && result.stopReason ? result.stopReason : 'verification-failed';
            const stats = (result && result.stats) || {};
            const diagnostic = [
              `stopReason=${reason}`,
              `status=${result && result.status}`,
              `searchesCompleted=${stats.searchesCompleted}`,
              `totalRows=${result && result.totalRows}`,
              `accepted=${result && result.records && result.records.length}`,
              `rejected=${result && result.rejectedCount}`,
              `countsConsistent=${stats.countsConsistent}`,
              `pageErrors=${JSON.stringify(getPageErrors(result).map((e) => e.code))}`,
            ].join(' ');
            await searchProgressRepository.markFailed(checkpoint.id, reason);
            await log(
              'WARN',
              `Search ${search.firstName}/${search.lastName} failed verification (${diagnostic}); no records imported for it.`
            );
            continue;
          }

          // Import immediately, while the verified rows are in hand. If the
          // process stops later, this search's rows are already persisted.
          await importService.importRecords({
            records: result.records,
            source: job.source,
            jobId: job.id,
          });

          await searchProgressRepository.markCompleted(checkpoint.id, {
            rowCount: result.totalRows,
            recordsInserted: result.records.length,
          });

          await log(
            'INFO',
            `Imported ${result.records.length} verified record(s) for ${search.firstName}/${search.lastName}.`
          );
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          await searchProgressRepository
            .markFailed(checkpoint.id, message)
            .catch(() => {});
          await log(
            'ERROR',
            `Search ${search.firstName}/${search.lastName} failed: ${message}`
          );
        }
      }

      // Honest final status: COMPLETED only when every planned search now has a
      // COMPLETED checkpoint, including searches finished in an earlier run.
      // Any unfinished search leaves the job FAILED so it can be resumed.
      const allCheckpoints = await searchProgressRepository.listForJob(job.id);
      const completedCount = allCheckpoints.filter(
        (checkpoint) => checkpoint.status === STATUS.COMPLETED
      ).length;
      const allSucceeded =
        allCheckpoints.length === searchPlan.length &&
        completedCount === searchPlan.length;

      if (allSucceeded) {
        await jobRepository.markCompleted(job.id);
        await log(
          'INFO',
          `Collection completed: all ${searchPlan.length} search(es) verified and imported.`
        );
      } else {
        await jobRepository.markFailed(
          job.id,
          `Collection incomplete: ${completedCount} of ${searchPlan.length} search(es) verified and imported. Resume to retry unfinished searches.`
        );
        await log(
          'WARN',
          'Not all searches succeeded; job marked FAILED so it can be resumed.'
        );
      }
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

module.exports = {
  createCollectionWorker,
  buildSearchPlan,
  searchSucceeded,
  SUPERVISED_SEARCHES,
};
