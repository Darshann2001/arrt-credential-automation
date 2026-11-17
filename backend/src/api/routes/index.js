'use strict';

const express = require('express');
const { createHealthRoutes } = require('./health.routes');
const { createRecordsRoutes } = require('./records.routes');
const { createJobsRoutes } = require('./jobs.routes');
const { createDashboardRoutes } = require('./dashboard.routes');

/**
 * Mounts every API route under `/api`.
 *
 * @param {{ controllers: object }} deps
 */
function createApiRouter({ controllers }) {
  const router = express.Router();

  router.use('/health', createHealthRoutes({ controller: controllers.health }));
  router.use('/records', createRecordsRoutes({ controller: controllers.records }));
  router.use('/jobs', createJobsRoutes({ controller: controllers.jobs }));
  router.use(
    '/dashboard',
    createDashboardRoutes({ controller: controllers.dashboard })
  );

  return router;
}

module.exports = { createApiRouter };
