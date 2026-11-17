'use strict';

const { z, uuidParamsSchema, paginationFields } = require('./common');

const SORTABLE_RECORD_FIELDS = Object.freeze([
  'createdAt',
  'updatedAt',
  'fullName',
  'city',
  'state',
  'credentialString',
]);

const MAX_IMPORT_RECORDS = 5000;

const recordsQuerySchema = z.object({
  ...paginationFields,
  search: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
  credential: z.string().trim().max(100).optional(),
  sortBy: z.enum(SORTABLE_RECORD_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const recordIdParamsSchema = uuidParamsSchema;

const importBodySchema = z
  .object({
    records: z
      .array(z.unknown())
      .min(1, 'records must contain at least one entry.')
      .max(MAX_IMPORT_RECORDS, `records must contain at most ${MAX_IMPORT_RECORDS} entries.`),
    source: z.string().trim().min(1).max(50).optional(),
    jobId: z.string().uuid({ message: 'jobId must be a valid UUID.' }).optional(),
  })
  .strict();

module.exports = {
  SORTABLE_RECORD_FIELDS,
  MAX_IMPORT_RECORDS,
  recordsQuerySchema,
  recordIdParamsSchema,
  importBodySchema,
};
