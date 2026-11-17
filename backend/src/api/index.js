'use strict';

/**
 * Public API layer.
 *
 * Importing this module does not connect to PostgreSQL; the Prisma client is
 * created lazily by `src/db/prisma.js` when the server starts.
 */

const { createApp } = require('./app');
const { createApiRouter } = require('./routes');
const { ApiError } = require('./errors/api-error');
const { createErrorHandler, mapError } = require('./middleware/error-handler');
const { validate } = require('./middleware/validate');
const {
  deriveCredentialType,
  groupByCredentialType,
} = require('./utils/credential-type');
const { toSkipTake, buildPaginationMeta } = require('./utils/pagination');

module.exports = {
  createApp,
  createApiRouter,
  ApiError,
  createErrorHandler,
  mapError,
  validate,
  deriveCredentialType,
  groupByCredentialType,
  toSkipTake,
  buildPaginationMeta,
};
