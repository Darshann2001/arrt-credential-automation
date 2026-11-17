'use strict';

/**
 * Pagination helpers shared by the records and jobs endpoints.
 */

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;

/**
 * @param {{ page: number, pageSize: number }} input
 * @returns {{ page: number, pageSize: number, skip: number, take: number }}
 */
function toSkipTake({ page, pageSize }) {
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

/**
 * @param {{ page: number, pageSize: number, total: number }} input
 */
function buildPaginationMeta({ page, pageSize, total }) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const totalPages = pageSize > 0 ? Math.ceil(safeTotal / pageSize) : 0;

  return {
    page,
    pageSize,
    total: safeTotal,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && safeTotal > 0,
  };
}

module.exports = {
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  toSkipTake,
  buildPaginationMeta,
};
