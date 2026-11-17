'use strict';

const { DEFAULT_TARGET_RECORDS } = require('../../automation/config');
const { z, uuidParamsSchema, paginationFields } = require('./common');

const JOB_STATUSES = Object.freeze([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const jobsQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(JOB_STATUSES).optional(),
});

const jobIdParamsSchema = uuidParamsSchema;

const createJobBodySchema = z
  .object({
    requestedTarget: z.coerce
      .number()
      .int('requestedTarget must be an integer.')
      .min(0, 'requestedTarget must be zero or greater.')
      .max(100000, 'requestedTarget is too large.')
      .default(DEFAULT_TARGET_RECORDS.max),
    source: z.string().trim().min(1).max(50).default('ARRT'),
  })
  .strict();

module.exports = {
  JOB_STATUSES,
  jobsQuerySchema,
  jobIdParamsSchema,
  createJobBodySchema,
};
