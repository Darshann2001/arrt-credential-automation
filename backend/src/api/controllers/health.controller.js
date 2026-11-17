'use strict';

const { asyncHandler } = require('../middleware/async-handler');

/**
 * Liveness/readiness probe. Reports database reachability without leaking
 * connection details.
 *
 * @param {{ prisma: object }} deps
 */
function createHealthController({ prisma }) {
  const getHealth = asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    let database = 'ok';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      database = 'unavailable';
    }

    const healthy = database === 'ok';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  return { getHealth };
}

module.exports = { createHealthController };
