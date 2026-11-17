'use strict';

const express = require('express');

/**
 * @param {{ controller: object }} deps
 */
function createHealthRoutes({ controller }) {
  const router = express.Router();
  router.get('/', controller.getHealth);
  return router;
}

module.exports = { createHealthRoutes };
