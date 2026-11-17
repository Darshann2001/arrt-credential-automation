'use strict';

const crypto = require('node:crypto');

/**
 * Assigns a request id for correlation without exposing internals.
 */
function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id =
    typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId };
