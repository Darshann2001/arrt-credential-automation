'use strict';

/**
 * Worker orchestration tests for the four reliability fixes:
 *   1. incomplete/failed searches never produce a COMPLETED job;
 *   2. per-search checkpoints let a job resume without repeating successes;
 *   3. records are imported immediately after each verified search;
 *   4. strict verification is required before a search counts as successful.
 *
 * These tests use in-memory doubles and never open a browser or contact ARRT.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { readEnv } = require('../config/env');
const {
  createCollectionWorker,
  searchSucceeded,
  buildSearchPlan,
  CURATED_FIRST_FRAGMENTS,
  CURATED_LAST_FRAGMENTS,
  SUPERVISED_SEARCHES,
  TOP_DIGRAPHS_PER_FIELD,
} = require('../workers/collection.worker');
const { createJobRepository } = require('../api/repositories/job.repository');
const {
  createSearchProgressRepository,
  STATUS,
} = require('../api/repositories/search-progress.repository');
const {
  createJobsController,
} = require('../api/controllers/jobs.controller');
const { createFakePrisma } = require('./helpers/fake-prisma');

const TEST_CONFIG = readEnv({
  LIVE_AUTHORIZATION_CONFIRMED: 'true',
  LIVE_AUTHORIZATION_REFERENCE: 'AUTH-TEST',
  LIVE_AUTHORIZATION_SCOPE: 'ARRT_VERIFY_CREDENTIALS,SUPERVISED_RUN',
  LIVE_CAPTCHA_APPROVED: 'true',
  LIVE_CAPTCHA_APPROVAL_REFERENCE: 'CAPTCHA-TEST',
  LIVE_MAX_RECORDS_PER_JOB: '350',
  LIVE_MAX_SEARCHES_PER_JOB: '100',
  LIVE_MAX_JOBS_PER_DAY: '10',
  LIVE_BROWSER_HEADLESS: 'false',
});

function record(name, index) {
  return {
    fullName: name,
    city: 'Vidalia',
    state: 'GA',
    credentialString: 'R.T.(R)(ARRT)',
    provenance: { searchIndex: index },
  };
}

function okResult(names = [], index = 0) {
  const records = names.map((name) => record(name, index));
  return {
    status: 'completed',
    stopReason: 'PLAN_EXHAUSTED',
    totalRows: records.length,
    records,
    stats: {
      searchesCompleted: 1,
      countsConsistent: true,
      // collectRecords() nests page errors under stats.extraction.
      extraction: { pageErrors: [] },
    },
  };
}

function failedResult() {
  return {
    status: 'stopped',
    stopReason: 'PROVIDER_ERROR',
    totalRows: 0,
    records: [],
    stats: {
      searchesCompleted: 0,
      countsConsistent: false,
      extraction: { pageErrors: [{ code: 'RESULT_COUNT_MISMATCH' }] },
    },
  };
}

async function waitForTerminalJob(jobRepository, jobId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await jobRepository.findById(jobId);
    if (job && ['COMPLETED', 'FAILED'].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Job ${jobId} did not reach a terminal state.`);
}

async function setup({ searches, collectImpl, jobStatus = 'PENDING' } = {}) {
  const prisma = createFakePrisma();
  const jobRepository = createJobRepository(prisma);
  const searchProgressRepository = createSearchProgressRepository(prisma);

  const job = await jobRepository.createWithLog({
    source: 'ARRT',
    requestedTarget: 350,
    message: 'test job',
  });

  if (jobStatus !== 'PENDING') {
    await jobRepository.markRunning(job.id);
    if (jobStatus === 'COMPLETED') {
      await jobRepository.markCompleted(job.id);
    } else if (jobStatus === 'FAILED') {
      await jobRepository.markFailed(job.id, 'previous failure');
    }
  }

  const imports = [];
  const importService = {
    async importRecords(input) {
      imports.push(input);
      return {
        received: input.records.length,
        inserted: input.records.length,
        skipped: 0,
        rejected: 0,
      };
    },
  };

  let collectCalls = 0;
  const worker = createCollectionWorker({
    jobRepository,
    importService,
    searchProgressRepository,
    config: TEST_CONFIG,
    searches,
    providerFactory: () => ({ close: async () => {} }),
    collectRecordsImpl: async (plan, options) => {
      collectCalls += 1;
      assert.equal(plan.length, 1, 'worker must collect one search at a time');
      assert.equal(options.allowLiveProvider, true);
      return collectImpl(plan[0], collectCalls);
    },
  });

  return {
    prisma,
    job,
    jobRepository,
    searchProgressRepository,
    worker,
    imports,
    getCollectCalls: () => collectCalls,
  };
}

// ---------------------------------------------------------------------------
// searchSucceeded() strictness
// ---------------------------------------------------------------------------

test('searchSucceeded requires a verified, complete single-search result', () => {
  assert.equal(searchSucceeded(okResult(['Alice Smith'])), true);
  assert.equal(searchSucceeded(okResult([])), true, 'a verified empty result is a success');

  assert.equal(searchSucceeded(failedResult()), false);
  assert.equal(
    searchSucceeded({ ...okResult(['A']), status: 'stopped' }),
    false
  );
  assert.equal(
    searchSucceeded({
      ...okResult(['A']),
      stats: { ...okResult(['A']).stats, searchesCompleted: 0 },
    }),
    false
  );
  assert.equal(
    searchSucceeded({
      ...okResult(['A']),
      stats: { ...okResult(['A']).stats, countsConsistent: false },
    }),
    false
  );
  assert.equal(
    searchSucceeded({
      ...okResult(['A']),
      stats: {
        ...okResult(['A']).stats,
        extraction: { pageErrors: [{ code: 'X' }] },
      },
    }),
    false
  );
  assert.equal(searchSucceeded(null), false);
});

// ---------------------------------------------------------------------------
// Honest final status
// ---------------------------------------------------------------------------

test('a fully verified run is marked COMPLETED and imports its records', async () => {
  const ctx = await setup({
    searches: [{ firstName: 'john', lastName: 'smith' }],
    collectImpl: () => okResult(['John Smith']),
  });

  await ctx.worker.startRun(ctx.job.id);
  const job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'COMPLETED');
  assert.equal(ctx.imports.length, 1);
  assert.deepEqual(
    ctx.imports[0].records.map((r) => r.fullName),
    ['John Smith']
  );

  const checkpoints = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].status, STATUS.COMPLETED);
  assert.equal(checkpoints[0].recordsInserted, 1);
});

test('an incomplete run is marked FAILED, never COMPLETED, and imports nothing', async () => {
  const ctx = await setup({
    searches: [{ firstName: 'john', lastName: 'smith' }],
    collectImpl: () => failedResult(),
  });

  await ctx.worker.startRun(ctx.job.id);
  const job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'FAILED');
  assert.match(job.errorMessage, /Collection incomplete/);
  assert.equal(ctx.imports.length, 0);

  const checkpoints = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.equal(checkpoints[0].status, STATUS.FAILED);
});

test('a thrown collection error marks the job FAILED', async () => {
  const ctx = await setup({
    searches: [{ firstName: 'john', lastName: 'smith' }],
    collectImpl: () => {
      throw new Error('grid verification failed');
    },
  });

  await ctx.worker.startRun(ctx.job.id);
  const job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'FAILED');
  assert.equal(ctx.imports.length, 0);
});

// ---------------------------------------------------------------------------
// Incremental import
// ---------------------------------------------------------------------------

test('records are imported per successful search, not once at the end', async () => {
  const ctx = await setup({
    searches: [
      { firstName: 'john', lastName: 'smith' },
      { firstName: 'mary', lastName: 'jones' },
    ],
    collectImpl: (search, callNumber) =>
      okResult([callNumber === 1 ? 'John Smith' : 'Mary Jones'], callNumber),
  });

  await ctx.worker.startRun(ctx.job.id);
  const job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'COMPLETED');
  assert.equal(ctx.imports.length, 2, 'one import per successful search');
  assert.deepEqual(ctx.imports.map((i) => i.records[0].fullName), [
    'John Smith',
    'Mary Jones',
  ]);
  assert.equal(ctx.getCollectCalls(), 2);

  const checkpoints = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.equal(checkpoints.length, 2);
  assert.ok(checkpoints.every((c) => c.status === STATUS.COMPLETED));
});

// ---------------------------------------------------------------------------
// Resume without repeating successful searches
// ---------------------------------------------------------------------------

test('a resumed job skips completed searches and retries only unfinished ones', async () => {
  const searches = [
    { firstName: 'john', lastName: 'smith' },
    { firstName: 'mary', lastName: 'jones' },
  ];

  // First run: search 1 succeeds, search 2 fails. Second run: search 2 succeeds.
  const collectImpl = (search, callNumber) => {
    if (callNumber === 1) return okResult(['John Smith'], 1);
    if (callNumber === 2) return failedResult();
    return okResult(['Mary Jones'], 3);
  };

  const ctx = await setup({ searches, collectImpl });

  await ctx.worker.startRun(ctx.job.id);
  let job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);
  assert.equal(job.status, 'FAILED');
  assert.equal(ctx.getCollectCalls(), 2);

  const afterFirstRun = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.equal(afterFirstRun[0].status, STATUS.COMPLETED);
  assert.equal(afterFirstRun[1].status, STATUS.FAILED);

  // Re-run the same (FAILED) job. Only the failed search should be collected.
  await ctx.worker.startRun(ctx.job.id);
  job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'COMPLETED');
  assert.equal(ctx.getCollectCalls(), 3, 'only the unfinished search ran again');
  assert.deepEqual(
    ctx.imports.map((i) => i.records[0].fullName),
    ['John Smith', 'Mary Jones']
  );

  const afterResume = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.ok(afterResume.every((c) => c.status === STATUS.COMPLETED));
});

test('checkpoints for an already-completed job are not reset', async () => {
  const ctx = await setup({
    searches: [{ firstName: 'john', lastName: 'smith' }],
    collectImpl: () => okResult(['John Smith']),
  });

  await ctx.worker.startRun(ctx.job.id);
  await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  // Simulate a fresh worker resuming the same plan: ensureMany must be a no-op
  // for the existing COMPLETED checkpoint, and no search should run again.
  const created = await ctx.searchProgressRepository.ensureMany(ctx.job.id, [
    { firstName: 'john', lastName: 'smith' },
  ]);
  assert.equal(created, 0);

  const checkpoints = await ctx.searchProgressRepository.listForJob(ctx.job.id);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].status, STATUS.COMPLETED);
});

// ---------------------------------------------------------------------------
// Worker status guard
// ---------------------------------------------------------------------------

test('worker refuses to run a COMPLETED or CANCELLED job', async () => {
  for (const status of ['COMPLETED', 'CANCELLED']) {
    const ctx = await setup({
      searches: [{ firstName: 'john', lastName: 'smith' }],
      collectImpl: () => okResult([]),
      jobStatus: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
    });

    if (status === 'CANCELLED') {
      await ctx.jobRepository.markFailed(ctx.job.id, 'x');
      const stored = ctx.prisma.__state.jobs.find((j) => j.id === ctx.job.id);
      stored.status = 'CANCELLED';
    }

    await assert.rejects(ctx.worker.startRun(ctx.job.id), /cannot be run/);
  }
});

test('worker allows resuming a FAILED job', async () => {
  const ctx = await setup({
    searches: [{ firstName: 'john', lastName: 'smith' }],
    collectImpl: () => okResult(['John Smith']),
    jobStatus: 'FAILED',
  });

  await ctx.worker.startRun(ctx.job.id);
  const job = await waitForTerminalJob(ctx.jobRepository, ctx.job.id);

  assert.equal(job.status, 'COMPLETED');
  assert.equal(ctx.getCollectCalls(), 1);
});

// ---------------------------------------------------------------------------
// Controller status guard
// ---------------------------------------------------------------------------

function callRun(jobsService, worker) {
  const controller = createJobsController({ jobsService, worker });
  return new Promise((resolve) => {
    const req = { validated: { params: { id: 'job-1' } } };
    const res = {
      status() {
        return this;
      },
      json(body) {
        resolve({ ok: true, body });
      },
    };
    controller.run(req, res, (error) => resolve({ ok: false, error }));
  });
}

test('jobs controller permits PENDING, RUNNING and FAILED runs', async () => {
  for (const status of ['PENDING', 'RUNNING', 'FAILED']) {
    const jobsService = { async getById() { return { id: 'job-1', status }; } };
    const worker = { async startRun() { return { id: 'job-1', status: 'RUNNING' }; } };
    const result = await callRun(jobsService, worker);
    assert.equal(result.ok, true, `${status} should be runnable`);
  }
});

test('jobs controller rejects COMPLETED and CANCELLED runs', async () => {
  for (const status of ['COMPLETED', 'CANCELLED']) {
    const jobsService = { async getById() { return { id: 'job-1', status }; } };
    const worker = { async startRun() { return { id: 'job-1', status: 'RUNNING' }; } };
    const result = await callRun(jobsService, worker);
    assert.equal(result.ok, false, `${status} should not be runnable`);
    assert.equal(result.error.code, 'JOB_NOT_RUNNABLE');
  }
});

// ---------------------------------------------------------------------------
// Curated digraph search plan (no ARRT wildcards)
// ---------------------------------------------------------------------------

test('buildSearchPlan uses curated digraph fragments without wildcards', () => {
  const plan = buildSearchPlan(100);

  assert.ok(plan.length >= 1);
  assert.ok(
    CURATED_FIRST_FRAGMENTS.every((fragment) => !fragment.includes('*')),
    'first-name fragments must be real digraphs, not A* wildcards'
  );
  assert.ok(
    CURATED_LAST_FRAGMENTS.every((fragment) => !fragment.includes('*')),
    'last-name fragments must be real digraphs, not A* wildcards'
  );

  for (const search of plan) {
    assert.ok(!search.firstName.includes('*'));
    assert.ok(!search.lastName.includes('*'));
    assert.ok(search.lastName.length >= 2);
  }

  assert.deepEqual(plan[0], { firstName: 'ch', lastName: 'ad' });
  assert.deepEqual(SUPERVISED_SEARCHES[0], { firstName: 'ch', lastName: 'ad' });
});

test('buildSearchPlan respects the search limit', () => {
  const plan = buildSearchPlan(1);
  assert.equal(plan.length, 1);
});

test('buildSearchPlan uses only the top-ranked digraph slice', () => {
  assert.equal(TOP_DIGRAPHS_PER_FIELD, 10);
  assert.equal(CURATED_FIRST_FRAGMENTS.length, TOP_DIGRAPHS_PER_FIELD);
  assert.equal(CURATED_LAST_FRAGMENTS.length, TOP_DIGRAPHS_PER_FIELD);
  assert.equal(CURATED_FIRST_FRAGMENTS[0], 'ch');
  assert.equal(CURATED_LAST_FRAGMENTS[0], 'ad');

  assert.equal(SUPERVISED_SEARCHES.length, TOP_DIGRAPHS_PER_FIELD ** 2);
  assert.deepEqual(buildSearchPlan(TOP_DIGRAPHS_PER_FIELD ** 2)[0], {
    firstName: 'ch',
    lastName: 'ad',
  });

  for (const search of SUPERVISED_SEARCHES) {
    assert.match(search.firstName, /^[a-z]{2}$/);
    assert.match(search.lastName, /^[a-z]{2}$/);
    assert.ok(!search.firstName.includes('*'));
    assert.ok(!search.lastName.includes('*'));
  }
});
