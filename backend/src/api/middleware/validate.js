'use strict';

const { ZodError } = require('zod');
const { ApiError } = require('../errors/api-error');

/**
 * Request validation middleware.
 *
 * Parsed values are stored on `req.validated` rather than overwriting
 * `req.query`/`req.params`, which keeps the middleware portable across Express
 * versions and makes the validated shape explicit in controllers.
 *
 * @param {{ params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, body?: import('zod').ZodTypeAny }} schemas
 */
function validate(schemas = {}) {
  return function validateRequest(req, res, next) {
    try {
      const validated = { ...(req.validated || {}) };

      if (schemas.params) {
        validated.params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        validated.query = schemas.query.parse(req.query);
      }

      if (schemas.body) {
        validated.body = schemas.body.parse(req.body);
      }

      req.validated = validated;
      next();
    } catch (error) {
      next(toValidationError(error));
    }
  };
}

/**
 * @param {unknown} error
 * @returns {unknown}
 */
function toValidationError(error) {
  if (!(error instanceof ZodError)) {
    return error;
  }

  return ApiError.badRequest('Invalid request.', {
    fields: error.issues.map((issue) => ({
      path: issue.path.join('.') || null,
      message: issue.message,
    })),
  });
}

module.exports = { validate, toValidationError };
