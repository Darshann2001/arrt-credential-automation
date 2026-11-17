'use strict';

const { ApiError } = require('../errors/api-error');
const { toSkipTake, buildPaginationMeta } = require('../utils/pagination');

/**
 * Record read operations.
 *
 * @param {{ recordRepository: ReturnType<typeof import('../repositories/record.repository').createRecordRepository> }} deps
 */
function createRecordsService({ recordRepository }) {
  return {
    /**
     * @param {object} query Validated list query.
     */
    async list(query) {
      const { page, pageSize, skip, take } = toSkipTake(query);
      const { total, rows } = await recordRepository.list({
        search: query.search,
        state: query.state,
        city: query.city,
        credential: query.credential,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
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
      const record = await recordRepository.findById(id);

      if (!record) {
        throw ApiError.notFound('Credential record not found.', 'RECORD_NOT_FOUND');
      }

      return record;
    },
  };
}

module.exports = { createRecordsService };
