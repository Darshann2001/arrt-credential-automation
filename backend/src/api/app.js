'use strict';

/**
 * Express application factory.
 *
 * Dependencies are injected so the HTTP layer can be tested without a live
 * PostgreSQL instance. Production passes the real Prisma client.
 */

const express = require('express');
const cors = require('cors');

const { readEnv } = require('../config/env');
const { buildCorsOptions } = require('../config/cors');
const { getPrisma } = require('../db/prisma');

const { requestId } = require('./middleware/request-id');
const { notFound } = require('./middleware/not-found');
const { createErrorHandler } = require('./middleware/error-handler');

const { createRecordRepository } = require('./repositories/record.repository');
const { createJobRepository } = require('./repositories/job.repository');
const {
  createSearchProgressRepository,
} = require('./repositories/search-progress.repository');

const { createRecordsService } = require('./services/records.service');
const { createImportService } = require('./services/import.service');
const { createJobsService } = require('./services/jobs.service');
const { createDashboardService } = require('./services/dashboard.service');
const {
  createCollectionWorker,
} = require('../workers/collection.worker');

const { createHealthController } = require('./controllers/health.controller');
const { createRecordsController } = require('./controllers/records.controller');
const { createJobsController } = require('./controllers/jobs.controller');
const {
  createDashboardController,
} = require('./controllers/dashboard.controller');

const { createApiRouter } = require('./routes');

/**
 * @param {object} [options]
 * @param {object} [options.prisma] Prisma client or compatible test double.
 * @param {ReturnType<typeof readEnv>} [options.config]
 * @param {{ error: Function, warn: Function }} [options.logger]
 * @returns {import('express').Express}
 */
function createApp(options = {}) {
  const config = options.config || readEnv();
  const logger = options.logger || console;
  const prisma = options.prisma || getPrisma();

  const recordRepository = createRecordRepository(prisma);
  const jobRepository = createJobRepository(prisma);
  const searchProgressRepository = createSearchProgressRepository(prisma);

  const recordsService = createRecordsService({ recordRepository });
  const importService = createImportService({ recordRepository, jobRepository });
  const jobsService = createJobsService({ jobRepository });
  const dashboardService = createDashboardService({
    recordRepository,
    jobRepository,
  });
  const worker = createCollectionWorker({
    jobRepository,
    importService,
    searchProgressRepository,
    config,
  });

  const controllers = {
    health: createHealthController({ prisma }),
    records: createRecordsController({ recordsService, importService }),
    jobs: createJobsController({ jobsService, worker }),
    dashboard: createDashboardController({ dashboardService }),
  };

  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors(buildCorsOptions(config.frontendOrigins)));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createApiRouter({ controllers }));

  app.use(notFound);
  app.use(createErrorHandler({ logger }));

  app.locals.prisma = prisma;
  app.locals.jobRepository = jobRepository;
  app.locals.worker = worker;

  return app;
}

module.exports = { createApp };
