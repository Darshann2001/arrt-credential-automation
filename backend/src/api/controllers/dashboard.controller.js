'use strict';

const { asyncHandler } = require('../middleware/async-handler');

/**
 * @param {{ dashboardService: object }} deps
 */
function createDashboardController({ dashboardService }) {
  const getStats = asyncHandler(async (req, res) => {
    const stats = await dashboardService.getStats(req.validated.query);
    res.json({ data: stats });
  });

  return { getStats };
}

module.exports = { createDashboardController };
