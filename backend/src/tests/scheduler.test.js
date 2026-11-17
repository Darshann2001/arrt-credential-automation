'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCollectionScheduler,
  msUntilNextRun,
} = require('../workers/collection.scheduler');
const { readEnv, parseCronHour } = require('../config/env');

test('cron config defaults to disabled and hour 2', () => {
  const config = readEnv({});
  assert.equal(config.collectionCron.enabled, false);
  assert.equal(config.collectionCron.hour, 2);
  assert.equal(parseCronHour(undefined), 2);
  assert.equal(parseCronHour('7'), 7);
  assert.throws(() => parseCronHour('24'), /COLLECTION_CRON_HOUR/);
});

test('msUntilNextRun targets the next occurrence of the hour', () => {
  const morning = new Date('2026-11-17T03:00:00');
  const delay = msUntilNextRun(5, morning);
  assert.equal(delay, 2 * 60 * 60 * 1000);

  const evening = new Date('2026-11-17T23:30:00');
  const nextDay = msUntilNextRun(2, evening);
  assert.equal(nextDay, 2.5 * 60 * 60 * 1000);
});

test('disabled scheduler never creates a job', async () => {
  let created = 0;
  const scheduler = createCollectionScheduler({
    jobRepository: {
      createWithLog: async () => {
        created += 1;
        return { id: 'job-1' };
      },
    },
    worker: { isBusy: () => false, startRun: async () => {} },
    config: readEnv({}),
  });

  scheduler.start();
  const result = await scheduler.trigger();
  assert.equal(result, null);
  assert.equal(created, 0);
  assert.equal(scheduler.isEnabled(), false);
});

test('enabled scheduler creates a job and starts the worker', async () => {
  const started = [];
  const scheduler = createCollectionScheduler({
    jobRepository: {
      createWithLog: async (input) => {
        assert.equal(input.source, 'ARRT');
        return { id: 'job-2' };
      },
      markFailed: async () => {},
    },
    worker: {
      isBusy: () => false,
      startRun: async (id) => started.push(id),
    },
    config: {
      collectionCron: { enabled: true, hour: 2 },
      live: { limits: { maxRecordsPerJob: 350 } },
    },
  });

  const job = await scheduler.trigger();
  assert.equal(job.id, 'job-2');
  assert.deepEqual(started, ['job-2']);
  assert.equal(scheduler.isEnabled(), true);
  scheduler.stop();
});

test('scheduler skips when the worker is busy', async () => {
  let created = 0;
  const scheduler = createCollectionScheduler({
    jobRepository: {
      createWithLog: async () => {
        created += 1;
        return { id: 'job-3' };
      },
    },
    worker: { isBusy: () => true, startRun: async () => {} },
    config: {
      collectionCron: { enabled: true, hour: 2 },
      live: { limits: { maxRecordsPerJob: 350 } },
    },
  });

  assert.equal(await scheduler.trigger(), null);
  assert.equal(created, 0);
});
