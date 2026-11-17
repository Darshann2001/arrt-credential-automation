'use strict';

/**
 * Terminal 404 handler for unknown routes.
 */
function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
    requestId: req.requestId || null,
  });
}

module.exports = { notFound };
