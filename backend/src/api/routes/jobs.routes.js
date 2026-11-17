'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const {
  jobsQuerySchema,
  jobIdParamsSchema,
  createJobBodySchema,
} = require('../validation/jobs');

/**
 * @param {{ controller: object }} deps
 */
function createJobsRoutes({ controller }) {
  const router = express.Router();

  router.get('/', validate({ query: jobsQuerySchema }), controller.list);

  router.post('/', validate({ body: createJobBodySchema }), controller.create);

  router.post(
    '/:id/run',
    validate({ params: jobIdParamsSchema }),
    controller.run
  );

  router.get('/:id', validate({ params: jobIdParamsSchema }), controller.getById);

  return router;
}

module.exports = { createJobsRoutes };
