'use strict';

/**
 * CORS configuration for the browser frontend.
 *
 * Requests without an `Origin` header (curl, server-to-server, health checks)
 * are allowed. Browser origins must match FRONTEND_URL exactly.
 *
 * @param {string[]} origins
 */
function buildCorsOptions(origins) {
  const allowed = new Set(origins);

  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
}

module.exports = { buildCorsOptions };
