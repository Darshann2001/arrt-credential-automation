'use strict';

/**
 * Operational API error.
 *
 * `details` must contain only client-safe information. Database messages,
 * stack traces and query fragments are never placed here.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code Stable machine-readable code.
   * @param {string} message Safe, human-readable message.
   * @param {object|null} [details]
   */
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Invalid request.', details = null) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static notFound(message = 'Resource not found.', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }

  static conflict(message = 'The request conflicts with an existing resource.', code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }

  static payloadTooLarge(message = 'Request payload is too large.') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }

  static serviceUnavailable(message = 'The service is temporarily unavailable.', code = 'SERVICE_UNAVAILABLE') {
    return new ApiError(503, code, message);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

module.exports = { ApiError };
