'use strict';

/**
 * HTTP-level tests for the database-backed API.
 *
 * A real Express app is started on an ephemeral port and driven with fetch. The
 * Prisma client is replaced by an in-memory double, so these tests need no
 * PostgreSQL instance and never contact ARRT.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../api/app');
const {
  deriveCredentialType,
  groupByCredentialType,
} = require('../api/utils/credential-type');
const { createFakePrisma, PrismaLikeError } = require('./helpers/fake-prisma');

const TEST_CONFIG = Object.freeze({
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://test:test@localhost:5432/arrt_test',
  frontendOrigins: ['http://localhost:3000'],
  isProduction: false,
});

const SILENT_LOGGER = Object.freeze({ error() {}, warn() {} });

const SAMPLE_RECORDS = Object.freeze([
  {
    fullName: '  Alice   Smith ',
    city: 'Springfield',
    state: 'Illinois',
    credentialString: 'TEST-0001',
  },
  {
    fullName: "Bob O'Neil",
    city: 'St. Louis',
    state: 'MO',
    credentialString: 'RT-2044',
  },
  {
    fullName: 'Carol de la Cruz',
    city: 'San Jose',
    state: 'CA',
    credentialString: 'R.T.(R)(CT)(ARRT)',
  },
  {
    fullName: 'Dan Reed',
    city: 'Reno',
    state: 'NV',
    credentialString: 'TEST-9002',
  },
  {
    fullName: 'Eve Stone',
    city: 'Austin',
    state: 'TX',
    credentialString: 'RT-7777',
  },
]);

async function startApi(prisma) {
  const app = createApp({
    prisma,
    config: TEST_CONFIG,
    logger: SILENT_LOGGER,
  });

  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();

  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function stop(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  const init = { method, headers: { ...headers } };

  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return { status: response.status, headers: response.headers, body: parsed };
}

async function importRecords(baseUrl, records, extra = {}) {
  return request(baseUrl, '/api/records/import', {
    method: 'POST',
    body: { records, ...extra },
  });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('GET /api/health reports ok when the database responds', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'ok');
  assert.ok(response.headers.get('x-request-id'));
});

test('GET /api/health degrades without leaking connection details', async (t) => {
  const prisma = createFakePrisma();
  prisma.__fail(
    '$queryRaw',
    '$queryRaw',
    new Error('connect ECONNREFUSED postgres://arrt:secret@db:5432')
  );

  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/health');

  assert.equal(response.status, 503);
  assert.equal(response.body.status, 'degraded');
  assert.equal(response.body.database, 'unavailable');
  assert.ok(!JSON.stringify(response.body).includes('secret'));
  assert.ok(!JSON.stringify(response.body).includes('ECONNREFUSED'));
});

// ---------------------------------------------------------------------------
// Record creation and normalization
// ---------------------------------------------------------------------------

test('POST /api/records/import normalizes records and reports counts', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await importRecords(baseUrl, SAMPLE_RECORDS.slice(0, 2));

  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      received: response.body.data.received,
      inserted: response.body.data.inserted,
      skipped: response.body.data.skipped,
      rejected: response.body.data.rejected,
    },
    { received: 2, inserted: 2, skipped: 0, rejected: 0 }
  );

  const list = await request(baseUrl, '/api/records?sortBy=fullName&sortOrder=asc');

  assert.equal(list.body.pagination.total, 2);

  const alice = list.body.data.find((record) => record.fullName === 'Alice Smith');
  assert.ok(alice, 'whitespace should be collapsed and trimmed');
  assert.equal(alice.state, 'IL', 'full state names normalize to postal codes');
  assert.equal(alice.city, 'Springfield');

  // Internal comparison keys are not exposed.
  assert.equal('normalizedName' in alice, false);
  assert.equal('normalizedCredential' in alice, false);

  const bob = list.body.data.find((record) => record.fullName === "Bob O'Neil");
  assert.equal(bob.state, 'MO');
});

test('POST /api/records/import skips duplicates against stored and in-batch rows', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const first = await importRecords(baseUrl, [SAMPLE_RECORDS[0]]);
  assert.equal(first.body.data.inserted, 1);

  const repeat = await importRecords(baseUrl, [SAMPLE_RECORDS[0]]);
  assert.deepEqual(
    {
      inserted: repeat.body.data.inserted,
      skipped: repeat.body.data.skipped,
      rejected: repeat.body.data.rejected,
    },
    { inserted: 0, skipped: 1, rejected: 0 }
  );

  const duplicate = {
    fullName: 'Dana Reed',
    city: 'Reno',
    state: 'NV',
    credentialString: 'TEST-9100',
  };

  const inBatch = await importRecords(baseUrl, [duplicate, duplicate]);
  assert.deepEqual(
    {
      received: inBatch.body.data.received,
      inserted: inBatch.body.data.inserted,
      skipped: inBatch.body.data.skipped,
    },
    { received: 2, inserted: 1, skipped: 1 }
  );

  const list = await request(baseUrl, '/api/records');
  assert.equal(list.body.pagination.total, 2);
});

test('POST /api/records/import rejects invalid rows without leaking values', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await importRecords(baseUrl, [
    { fullName: '   ', city: 'Reno', state: 'NV', credentialString: 'TEST-1' },
    { fullName: 'Eve Stone', city: '', state: 'NV', credentialString: 'TEST-2' },
    {
      fullName: 'Eve Stone',
      city: 'Reno',
      state: 'NotAState',
      credentialString: 'TEST-3',
    },
    { fullName: 'Eve Stone', city: 'Reno', state: 'NV', credentialString: '' },
    'not-an-object',
    {
      fullName: 'Valid Person',
      city: 'Reno',
      state: 'NV',
      credentialString: 'TEST-4',
    },
  ]);

  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      received: response.body.data.received,
      inserted: response.body.data.inserted,
      skipped: response.body.data.skipped,
      rejected: response.body.data.rejected,
    },
    { received: 6, inserted: 1, skipped: 0, rejected: 5 }
  );

  const codes = new Set(
    response.body.data.rejectedRecords.map((entry) => entry.code)
  );
  assert.ok(codes.has('MISSING_FULL_NAME'));
  assert.ok(codes.has('MISSING_CITY'));
  assert.ok(codes.has('INVALID_STATE'));
  assert.ok(codes.has('MISSING_CREDENTIAL'));
  assert.ok(codes.has('INVALID_RECORD'));

  const serialized = JSON.stringify(response.body.data.rejectedRecords);
  assert.ok(!serialized.includes('NotAState'), 'raw values must not be echoed');
});

test('POST /api/records/import links counters to an existing job', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const created = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 10 },
  });
  const jobId = created.body.data.id;

  const imported = await importRecords(baseUrl, SAMPLE_RECORDS.slice(0, 3), {
    jobId,
  });

  assert.equal(imported.status, 200);
  assert.equal(imported.body.data.jobId, jobId);

  const job = await request(baseUrl, `/api/jobs/${jobId}`);

  assert.equal(job.body.data.recordsFound, 3);
  assert.equal(job.body.data.recordsInserted, 3);
  assert.equal(job.body.data.recordsSkipped, 0);
  assert.equal(job.body.data.recordsRejected, 0);
  assert.ok(job.body.data.logs.length >= 2);
});

test('POST /api/records/import rejects an unknown job id', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await importRecords(baseUrl, [SAMPLE_RECORDS[0]], {
    jobId: '00000000-0000-4000-8000-000000000000',
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'JOB_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Search, filtering, pagination, sorting
// ---------------------------------------------------------------------------

test('GET /api/records searches by name case-insensitively', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, SAMPLE_RECORDS);

  const upper = await request(baseUrl, '/api/records?search=ALICE');
  assert.equal(upper.body.pagination.total, 1);

  const partial = await request(baseUrl, '/api/records?search=stone');
  assert.equal(partial.body.pagination.total, 1);
  assert.equal(partial.body.data[0].fullName, 'Eve Stone');

  const none = await request(baseUrl, '/api/records?search=zzz');
  assert.equal(none.body.pagination.total, 0);
  assert.deepEqual(none.body.data, []);
});

test('GET /api/records filters by state, city and credential', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, SAMPLE_RECORDS);

  const byStateName = await request(baseUrl, '/api/records?state=Illinois');
  assert.equal(byStateName.body.pagination.total, 1);
  assert.equal(byStateName.body.data[0].fullName, 'Alice Smith');

  const byStateCode = await request(baseUrl, '/api/records?state=CA');
  assert.equal(byStateCode.body.pagination.total, 1);

  const byCity = await request(baseUrl, '/api/records?city=spring');
  assert.equal(byCity.body.pagination.total, 1);
  assert.equal(byCity.body.data[0].city, 'Springfield');

  const byCredential = await request(baseUrl, '/api/records?credential=rt-77');
  assert.equal(byCredential.body.pagination.total, 1);
  assert.equal(byCredential.body.data[0].credentialString, 'RT-7777');

  const combined = await request(baseUrl, '/api/records?state=NV&city=reno');
  assert.equal(combined.body.pagination.total, 1);
});

test('GET /api/records paginates with total metadata', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, SAMPLE_RECORDS);

  const page2 = await request(
    baseUrl,
    '/api/records?page=2&pageSize=2&sortBy=fullName&sortOrder=asc'
  );

  assert.equal(page2.status, 200);
  assert.equal(page2.body.data.length, 2);
  assert.deepEqual(page2.body.pagination, {
    page: 2,
    pageSize: 2,
    total: 5,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });

  const page3 = await request(
    baseUrl,
    '/api/records?page=3&pageSize=2&sortBy=fullName&sortOrder=asc'
  );
  assert.equal(page3.body.data.length, 1);
  assert.equal(page3.body.pagination.hasNextPage, false);

  const beyond = await request(baseUrl, '/api/records?page=9&pageSize=2');
  assert.deepEqual(beyond.body.data, []);
  assert.equal(beyond.body.pagination.total, 5);
});

test('GET /api/records uses a deterministic id tiebreaker when sorting', async (t) => {
  const prisma = createFakePrisma();
  const findManyCalls = [];
  const originalFindMany = prisma.credentialRecord.findMany;
  prisma.credentialRecord.findMany = async (args) => {
    findManyCalls.push(args);
    return originalFindMany(args);
  };

  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(
    baseUrl,
    '/api/records?page=1&pageSize=2&sortBy=createdAt&sortOrder=desc'
  );

  assert.equal(response.status, 200);
  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(findManyCalls[0].orderBy, [
    { createdAt: 'desc' },
    { id: 'desc' },
  ]);
});

test('GET /api/records sorts by whitelisted fields in both directions', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, SAMPLE_RECORDS);

  const ascending = await request(
    baseUrl,
    '/api/records?sortBy=fullName&sortOrder=asc&pageSize=10'
  );
  const descending = await request(
    baseUrl,
    '/api/records?sortBy=fullName&sortOrder=desc&pageSize=10'
  );

  assert.equal(ascending.body.data[0].fullName, 'Alice Smith');
  assert.equal(descending.body.data[0].fullName, 'Eve Stone');
  assert.deepEqual(
    ascending.body.data.map((record) => record.fullName),
    [...ascending.body.data.map((record) => record.fullName)].sort((a, b) =>
      a.localeCompare(b)
    )
  );
});

// ---------------------------------------------------------------------------
// Record detail
// ---------------------------------------------------------------------------

test('GET /api/records/:id returns one record and 404s for unknown ids', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, [SAMPLE_RECORDS[0]]);

  const list = await request(baseUrl, '/api/records');
  const { id } = list.body.data[0];

  const found = await request(baseUrl, `/api/records/${id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.data.id, id);
  assert.equal(found.body.data.fullName, 'Alice Smith');

  const missing = await request(
    baseUrl,
    '/api/records/00000000-0000-4000-8000-000000000000'
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'RECORD_NOT_FOUND');

  const invalid = await request(baseUrl, '/api/records/not-a-uuid');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

test('POST /api/jobs creates a pending job with a log and no live collection', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: {},
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'PENDING');
  assert.equal(response.body.data.requestedTarget, 350);
  assert.equal(response.body.data.recordsFound, 0);
  assert.equal(response.body.data.recordsInserted, 0);
  assert.equal(response.body.data.startedAt, null);
  assert.equal(response.body.data.completedAt, null);

  const detail = await request(baseUrl, `/api/jobs/${response.body.data.id}`);

  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.logs.length, 1);
  assert.match(detail.body.data.logs[0].message, /live ARRT collection is disabled/i);
  assert.equal(detail.body.data.logs[0].level, 'INFO');
});

test('GET /api/jobs paginates and filters by status', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const first = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 5 },
  });
  const second = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 7 },
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  // Simulate a job that already finished elsewhere.
  const stored = prisma.__state.jobs.find(
    (job) => job.id === second.body.data.id
  );
  stored.status = 'COMPLETED';

  const page = await request(baseUrl, '/api/jobs?page=1&pageSize=1');
  assert.equal(page.body.pagination.total, 2);
  assert.equal(page.body.pagination.totalPages, 2);
  assert.equal(page.body.data.length, 1);

  const completed = await request(baseUrl, '/api/jobs?status=COMPLETED');
  assert.equal(completed.body.pagination.total, 1);
  assert.equal(completed.body.data[0].id, second.body.data.id);

  const failed = await request(baseUrl, '/api/jobs?status=FAILED');
  assert.equal(failed.body.pagination.total, 0);
});

test('GET /api/jobs/:id returns job details with ordered logs', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const created = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 12 },
  });

  await importRecords(baseUrl, SAMPLE_RECORDS.slice(0, 2), {
    jobId: created.body.data.id,
  });

  const detail = await request(baseUrl, `/api/jobs/${created.body.data.id}`);

  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.requestedTarget, 12);
  assert.equal(detail.body.data.recordsFound, 2);
  assert.equal(detail.body.data.logs.length, 2);

  const timestamps = detail.body.data.logs.map((log) =>
    new Date(log.createdAt).getTime()
  );
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));

  const missing = await request(
    baseUrl,
    '/api/jobs/00000000-0000-4000-8000-000000000000'
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'JOB_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test('GET /api/dashboard/stats aggregates records and jobs', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  await importRecords(baseUrl, [
    { fullName: 'Alice Smith', city: 'Springfield', state: 'IL', credentialString: 'RT-101' },
    { fullName: 'Bob ONeil', city: 'St. Louis', state: 'MO', credentialString: 'R.T.(R)(CT)' },
    { fullName: 'Carol Cruz', city: 'San Jose', state: 'CA', credentialString: 'TEST-0001' },
    { fullName: 'Dan Reed', city: 'Los Angeles', state: 'CA', credentialString: 'RT-202' },
  ]);

  const completedJob = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 10 },
  });
  const failedJob = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: 20 },
  });

  prisma.__state.jobs.find((job) => job.id === completedJob.body.data.id).status =
    'COMPLETED';
  prisma.__state.jobs.find((job) => job.id === failedJob.body.data.id).status =
    'FAILED';

  const response = await request(baseUrl, '/api/dashboard/stats');
  const stats = response.body.data;

  assert.equal(response.status, 200);
  assert.equal(stats.totalRecords, 4);
  assert.equal(stats.totalJobs, 2);
  assert.equal(stats.completedJobs, 1);
  assert.equal(stats.failedJobs, 1);
  assert.equal(stats.recordsAddedRecently.count, 4);
  assert.equal(stats.recordsAddedRecently.windowDays, 30);

  const california = stats.recordsByState.find((row) => row.state === 'CA');
  assert.deepEqual(california, { state: 'CA', count: 2 });
  assert.equal(stats.recordsByState[0].count, 2);

  const types = new Map(
    stats.recordsByCredentialType.map((row) => [row.credentialType, row.count])
  );
  assert.equal(types.get('RT'), 2);
  assert.equal(types.get('R'), 1);
  assert.equal(types.get('TEST'), 1);

  const windowed = await request(baseUrl, '/api/dashboard/stats?recentDays=1');
  assert.equal(windowed.body.data.recordsAddedRecently.windowDays, 1);
  assert.equal(windowed.body.data.recordsAddedRecently.count, 4);
});

test('dashboard credential grouping is deterministic and conservative', () => {
  assert.equal(deriveCredentialType('RT-123'), 'RT');
  assert.equal(deriveCredentialType('R.T.(R)(CT)(ARRT)'), 'R');
  assert.equal(deriveCredentialType('test-0001'), 'TEST');
  assert.equal(deriveCredentialType('   '), 'UNKNOWN');
  assert.equal(deriveCredentialType(undefined), 'UNKNOWN');

  assert.deepEqual(groupByCredentialType(['RT-1', 'RT-2', 'TEST-9']), [
    { credentialType: 'RT', count: 2 },
    { credentialType: 'TEST', count: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('invalid query parameters return 400 with safe field details', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const badPage = await request(baseUrl, '/api/records?page=0');
  assert.equal(badPage.status, 400);
  assert.equal(badPage.body.error.code, 'VALIDATION_ERROR');
  assert.equal(badPage.body.error.details.fields[0].path, 'page');

  const hugePage = await request(baseUrl, '/api/records?pageSize=5000');
  assert.equal(hugePage.status, 400);

  const badSort = await request(baseUrl, '/api/records?sortBy=password');
  assert.equal(badSort.status, 400);
  assert.equal(badSort.body.error.details.fields[0].path, 'sortBy');

  const badStatus = await request(baseUrl, '/api/jobs?status=DONE');
  assert.equal(badStatus.status, 400);

  const badRecent = await request(baseUrl, '/api/dashboard/stats?recentDays=0');
  assert.equal(badRecent.status, 400);
});

test('invalid request bodies return 400 before touching the database', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const noRecords = await request(baseUrl, '/api/records/import', {
    method: 'POST',
    body: {},
  });
  assert.equal(noRecords.status, 400);

  const emptyRecords = await request(baseUrl, '/api/records/import', {
    method: 'POST',
    body: { records: [] },
  });
  assert.equal(emptyRecords.status, 400);

  const unknownField = await request(baseUrl, '/api/records/import', {
    method: 'POST',
    body: { records: [SAMPLE_RECORDS[0]], admin: true },
  });
  assert.equal(unknownField.status, 400);

  const negativeTarget = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: { requestedTarget: -5 },
  });
  assert.equal(negativeTarget.status, 400);
  assert.equal(negativeTarget.body.error.details.fields[0].path, 'requestedTarget');

  const malformedJson = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: '{not json',
  });
  assert.equal(malformedJson.status, 400);
  assert.equal(malformedJson.body.error.code, 'VALIDATION_ERROR');

  assert.equal(prisma.__state.jobs.length, 0);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('database connection errors map to 503 without internal details', async (t) => {
  const prisma = createFakePrisma();
  prisma.__fail(
    'credentialRecord',
    'count',
    new PrismaLikeError('P1001', "Can't reach database server at db:5432")
  );

  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/records');

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(response.body.error.message, 'The database is temporarily unavailable.');

  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes('db:5432'));
  assert.ok(!serialized.includes('stack'));
});

test('unexpected errors map to a generic 500 without stack traces', async (t) => {
  const prisma = createFakePrisma();
  prisma.__fail(
    'credentialRecord',
    'count',
    new Error('password=super-secret internal detail')
  );

  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/records');

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(response.body.error.message, 'An unexpected error occurred.');

  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes('super-secret'));
  assert.ok(!serialized.includes('at '));
});

test('unique constraint errors map to a safe 409', async (t) => {
  const prisma = createFakePrisma();
  prisma.__fail(
    'credentialRecord',
    'createMany',
    new PrismaLikeError('P2002', 'Unique constraint failed on identity key')
  );

  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await importRecords(baseUrl, [SAMPLE_RECORDS[0]]);

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'DUPLICATE_RECORD');
  assert.ok(!JSON.stringify(response.body).includes('identity key'));
});

test('unknown routes return a JSON 404', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const response = await request(baseUrl, '/api/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test('CORS allows the configured frontend origin only', async (t) => {
  const prisma = createFakePrisma();
  const { server, baseUrl } = await startApi(prisma);
  t.after(() => stop(server));

  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'http://localhost:3000'
  );

  const denied = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://evil.example' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const noOrigin = await fetch(`${baseUrl}/api/health`);
  assert.equal(noOrigin.status, 200);
});
