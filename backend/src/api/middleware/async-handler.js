'use strict';

/**
 * Wraps an async route handler so rejected promises reach the error middleware.
 *
 * @param {Function} handler
 * @returns {Function}
 */
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
