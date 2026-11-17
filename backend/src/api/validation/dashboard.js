'use strict';

const { z } = require('zod');

const dashboardQuerySchema = z.object({
  recentDays: z.coerce
    .number()
    .int('recentDays must be an integer.')
    .min(1, 'recentDays must be at least 1.')
    .max(365, 'recentDays must be at most 365.')
    .default(30),
});

module.exports = { dashboardQuerySchema };
