'use strict';

const { ApiError } = require('../errors/api-error');

const PRISMA_UNIQUE = 'P2002';
const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_RELATION = 'P2003';

/**
 * Centralized error middleware.
 *
 * Client responses contain only a stable code, a safe message and optional safe
 * details. Stack traces, SQL, connection strings and driver messages are logged
 * server-side and never returned.
 *
 * @param {object} [options]
 * @param {{ error: Function, warn: Function }} [options.logger]
 */
function createErrorHandler({ logger = console } = {}) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) {
      return next(error);
    }

    const mapped = mapError(error);

    if (mapped.statusCode >= 500) {
      logger.error(
        JSON.stringify({
          level: 'error',
          requestId: req.requestId || null,
          method: req.method,
          path: req.originalUrl,
          code: mapped.code,
          statusCode: mapped.statusCode,
          // Server-side only: never forwarded to the client.
          reason: error instanceof Error ? error.message : String(error),
        })
      );
    }

    res.status(mapped.statusCode).json({
      error: mapped.toJSON(),
      requestId: req.requestId || null,
    });
  };
}

/**
 * @param {unknown} error
 * @returns {ApiError}
 */
function mapError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  // Body parser failures.
  if (error && error.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.');
  }

  if (error && error.type === 'entity.too.large') {
    return ApiError.payloadTooLarge();
  }

  const prismaCode = typeof error?.code === 'string' ? error.code : null;

  if (prismaCode === PRISMA_UNIQUE) {
    return ApiError.conflict(
      'A record with the same name, city, state and credential already exists.',
      'DUPLICATE_RECORD'
    );
  }

  if (prismaCode === PRISMA_NOT_FOUND) {
    return ApiError.notFound('The requested resource does not exist.');
  }

  if (prismaCode === PRISMA_RELATION) {
    return ApiError.conflict(
      'The request conflicts with a related resource.',
      'RELATION_CONFLICT'
    );
  }

  // Prisma connection / initialization failures (P1000-P1999).
  if (prismaCode && /^P1\d{3}$/.test(prismaCode)) {
    return ApiError.serviceUnavailable(
      'The database is temporarily unavailable.',
      'DATABASE_UNAVAILABLE'
    );
  }

  // Unknown Prisma error: treat as an internal failure, never echo the message.
  if (prismaCode && /^P\d{4}$/.test(prismaCode)) {
    return new ApiError(500, 'DATABASE_ERROR', 'The database request failed.');
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

module.exports = {
  createErrorHandler,
  mapError,
};
