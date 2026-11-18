'use strict';

const { asyncHandler } = require('../middleware/async-handler');
const { ApiError } = require('../errors/api-error');

/**
 * @param {{ jobsService: object, worker: object }} deps
 */
function createJobsController({ jobsService, worker }) {
  const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await jobsService.list(req.validated.query);
    res.json({ data: rows, pagination });
  });

  const getById = asyncHandler(async (req, res) => {
    const job = await jobsService.getById(req.validated.params.id);
    res.json({ data: job });
  });

  const create = asyncHandler(async (req, res) => {
    const job = await jobsService.create(req.validated.body);
    res.status(201).json({ data: job });
  });

  const run = asyncHandler(async (req, res) => {
    const job = await jobsService.getById(req.validated.params.id);

    // PENDING starts a fresh run; RUNNING (interrupted) and FAILED (partial)
    // jobs may be resumed so completed searches are not repeated. COMPLETED
    // and CANCELLED are terminal.
    if (!['PENDING', 'RUNNING', 'FAILED'].includes(job.status)) {
      throw ApiError.conflict(
        `Jobs with status ${job.status} cannot be run. Only PENDING, RUNNING or FAILED jobs can be run.`,
        'JOB_NOT_RUNNABLE'
      );
    }

    const updated = await worker.startRun(job.id);
    res.json({ data: updated });
  });

  return { list, getById, create, run };
}

module.exports = { createJobsController };
