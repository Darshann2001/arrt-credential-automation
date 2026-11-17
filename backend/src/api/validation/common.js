'use strict';

const { z } = require('zod');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const uuidParamsSchema = z
  .object({
    id: z.string().uuid({ message: 'id must be a valid UUID.' }),
  })
  .strict();

const paginationFields = {
  page: z.coerce
    .number()
    .int('page must be an integer.')
    .min(1, 'page must be at least 1.')
    .default(DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int('pageSize must be an integer.')
    .min(1, 'pageSize must be at least 1.')
    .max(MAX_PAGE_SIZE, `pageSize must be at most ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE),
};

module.exports = {
  z,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  uuidParamsSchema,
  paginationFields,
};
