'use strict';

/**
 * Offline extraction demo.
 *
 * Run with: npm run demo:extraction
 *
 * Loads only local synthetic fixtures. No network access occurs.
 */

const path = require('node:path');

const { extractRecords } = require('../index');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

const result = extractRecords([
  path.join(FIXTURE_DIR, 'normal.html'),
  { fixturePath: path.join(FIXTURE_DIR, 'page-1.html'), page: 2 },
  { fixturePath: path.join(FIXTURE_DIR, 'page-2.html'), page: 3 },
]);

console.log('ARRT fixture extraction demo (synthetic data only)');
console.log(
  JSON.stringify(
    {
      totalRows: result.totalRows,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      duplicateCount: result.duplicateCount,
      duplicateStrategies: result.stats.duplicateStrategies,
      pagesProcessed: result.stats.pagesProcessed,
      records: result.records,
      rejectedRows: result.rejectedRows,
    },
    null,
    2
  )
);
