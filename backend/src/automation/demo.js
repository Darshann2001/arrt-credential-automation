'use strict';

/**
 * Offline automation demo.
 *
 * Uses the synthetic fixture provider and the existing extraction engine. No
 * network access, browser launch or CAPTCHA handling takes place.
 */

const path = require('node:path');

const { collectRecords } = require('./collection.service');
const { createMockProvider } = require('./providers/mock.provider');

const FIXTURE_DIR = path.join(__dirname, '..', 'extraction', 'fixtures');

async function main() {
  const provider = createMockProvider({
    fixtures: [
      path.join(FIXTURE_DIR, 'normal.html'),
      path.join(FIXTURE_DIR, 'page-1.html'),
      path.join(FIXTURE_DIR, 'page-2.html'),
    ],
  });

  const result = await collectRecords(
    [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Cross', lastName: 'Person' },
      { firstName: 'Second', lastName: 'Person' },
    ],
    {
      provider,
      minIntervalMs: 0,
      maxRetries: 0,
      target: { min: 1, max: 100 },
      stopOnAccessDenial: true,
    }
  );

  console.log('ARRT automation demo (mock provider, synthetic fixtures)');
  console.log(
    JSON.stringify(
      {
        status: result.status,
        stopReason: result.stopReason,
        totalRows: result.totalRows,
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        duplicateCount: result.duplicateCount,
        records: result.records,
        requests: result.stats.requests,
        retries: result.stats.retries,
        monitoring: {
          requestSummary: result.stats.monitoring.requests,
          errorSummary: result.stats.monitoring.errors,
          ipSummary: result.stats.monitoring.ip,
        },
        circuitBreaker: result.stats.circuitBreaker,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
