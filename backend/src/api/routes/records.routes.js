'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const {
  recordsQuerySchema,
  recordIdParamsSchema,
  importBodySchema,
} = require('../validation/records');

/**
 * @param {{ controller: object }} deps
 */
function createRecordsRoutes({ controller }) {
  const router = express.Router();

  router.get('/', validate({ query: recordsQuerySchema }), controller.list);

  router.post(
    '/import',
    validate({ body: importBodySchema }),
    controller.importRecords
  );

  router.get(
    '/:id',
    validate({ params: recordIdParamsSchema }),
    controller.getById
  );

  return router;
}

module.exports = { createRecordsRoutes };
