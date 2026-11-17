'use strict';

/**
 * Lazily creates the shared Prisma client.
 *
 * The client is required lazily so that tests and offline tooling can import
 * the API without a generated client or a live database. Only the server entry
 * point and real deployments call `getPrisma()`.
 */

/** @type {import('@prisma/client').PrismaClient|null} */
let client = null;

function getPrisma() {
  if (client) {
    return client;
  }

  const { PrismaClient } = require('@prisma/client');

  client = new PrismaClient({
    log: ['warn', 'error'],
  });

  return client;
}

/**
 * @param {object} [instance]
 */
async function disconnectPrisma(instance = client) {
  if (!instance) {
    return;
  }

  await instance.$disconnect();
  client = null;
}

/**
 * Test helper: replace the singleton. Not used in production paths.
 *
 * @param {object|null} instance
 */
function setPrisma(instance) {
  client = instance;
}

module.exports = {
  getPrisma,
  disconnectPrisma,
  setPrisma,
};
