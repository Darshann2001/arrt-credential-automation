#!/usr/bin/env node
'use strict';

/**
 * API server entry point.
 *
 *   npm run api:start
 *
 * Requires DATABASE_URL. The server never opens a browser and never contacts
 * ARRT; it only serves stored data over HTTP.
 */

const fs = require('node:fs');
const path = require('node:path');

const { readEnv, assertRuntimeEnv } = require('../config/env');
const { getPrisma, disconnectPrisma } = require('../db/prisma');
const { createApp } = require('./app');
const {
  createCollectionScheduler,
} = require('../workers/collection.scheduler');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

/**
 * Loads backend/.env when present. Node >= 20.12 can parse .env natively, so no
 * dotenv dependency is required.
 */
function loadDotEnv() {
  if (fs.existsSync(ENV_PATH) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(ENV_PATH);
  }
}

async function main() {
  loadDotEnv();

  const config = readEnv();
  assertRuntimeEnv(config);

  const prisma = getPrisma();
  const app = createApp({ prisma, config });

  const scheduler = createCollectionScheduler({
    jobRepository: app.locals.jobRepository,
    worker: app.locals.worker,
    config,
  });
  scheduler.start();

  const server = app.listen(config.port, () => {
    console.log(
      `ARRT API listening on http://localhost:${config.port} (${config.nodeEnv})`
    );
  });

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down.`);

    server.close(async () => {
      scheduler.stop();
      await disconnectPrisma(prisma).catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`API failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { loadDotEnv, main };
