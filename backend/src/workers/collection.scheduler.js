'use strict';

/**
 * Daily collection scheduler.
 *
 * Triggers one supervised collection run per day by creating a PENDING job and
 * handing it to the existing worker. It opens a visible Chrome window and waits
 * for the operator to solve the reCAPTCHA — it does NOT solve, read or inject a
 * CAPTCHA token. If no operator is present, the run times out and fails.
 *
 * Disabled by default. Enable with COLLECTION_CRON_ENABLED=true and optionally
 * set COLLECTION_CRON_HOUR (0-23, local time).
 */

function msUntilNextRun(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * @param {object} deps
 * @param {object} deps.jobRepository
 * @param {{ isBusy: Function, startRun: Function }} deps.worker
 * @param {object} deps.config
 * @param {{ info?: Function, warn?: Function, error?: Function }} [deps.logger]
 */
function createCollectionScheduler({ jobRepository, worker, config, logger = console }) {
  const cron = (config && config.collectionCron) || {};
  const hour = Number.isInteger(cron.hour) ? cron.hour : 2;
  const enabled = cron.enabled === true;
  let timer = null;
  let stopped = false;

  function scheduleNext() {
    if (!enabled || stopped) {
      return;
    }
    const delay = msUntilNextRun(hour);
    timer = setTimeout(() => {
      void trigger().finally(() => {
        if (!stopped) {
          scheduleNext();
        }
      });
    }, delay);
  }

  async function trigger() {
    if (!enabled) {
      logger.warn?.('[scheduler] Collection scheduling is disabled; skipping.');
      return null;
    }

    if (worker.isBusy()) {
      logger.warn?.('[scheduler] A collection job is already running; skipping.');
      return null;
    }

    const target =
      (config.live && config.live.limits.maxRecordsPerJob) || 350;

    let job;
    try {
      job = await jobRepository.createWithLog({
        source: 'ARRT',
        requestedTarget: target,
        message: 'Scheduled daily collection started. Solve the CAPTCHA in the visible Chrome window.',
      });
      await worker.startRun(job.id);
      logger.info?.(
        `[scheduler] Started collection job ${job.id} for ${target} records.`
      );
      return job;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      logger.error?.(`[scheduler] Daily collection failed: ${message}`);
      if (job && job.id && typeof jobRepository.markFailed === 'function') {
        await jobRepository.markFailed(job.id, message).catch(() => {});
      }
      return null;
    }
  }

  function start() {
    scheduleNext();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { start, stop, trigger, isEnabled: () => enabled };
}

module.exports = { createCollectionScheduler, msUntilNextRun };
