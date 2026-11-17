'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { dashboardQuerySchema } = require('../validation/dashboard');

/**
 * @param {{ controller: object }} deps
 */
function createDashboardRoutes({ controller }) {
  const router = express.Router();

  router.get(
    '/stats',
    validate({ query: dashboardQuerySchema }),
    controller.getStats
  );

  return router;
}

module.exports = { createDashboardRoutes };
