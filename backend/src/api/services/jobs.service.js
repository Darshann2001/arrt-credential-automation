'use strict';

const { ApiError } = require('../errors/api-error');
const { toSkipTake, buildPaginationMeta } = require('../utils/pagination');

const CREATED_MESSAGE =
  'Collection job created with status PENDING. Live ARRT collection is disabled in this phase.';

/**
 * @param {{ jobRepository: object }} deps
 */
function createJobsService({ jobRepository }) {
  return {
    /**
     * @param {object} query
     */
    async list(query) {
      const { page, pageSize, skip, take } = toSkipTake(query);
      const { total, rows } = await jobRepository.list({
        status: query.status,
        skip,
        take,
      });

      return {
        rows,
        pagination: buildPaginationMeta({ page, pageSize, total }),
      };
    },

    /**
     * @param {string} id
     */
    async getById(id) {
      const job = await jobRepository.findByIdWithLogs(id);

      if (!job) {
        throw ApiError.notFound('Collection job not found.', 'JOB_NOT_FOUND');
      }

      return job;
    },

    /**
     * Creates a job record only. No provider is invoked and no browser opens.
     *
     * @param {{ requestedTarget: number, source: string }} input
     */
    async create({ requestedTarget, source }) {
      return jobRepository.createWithLog({
        source,
        requestedTarget,
        message: CREATED_MESSAGE,
      });
    },
  };
}

module.exports = { CREATED_MESSAGE, createJobsService };
