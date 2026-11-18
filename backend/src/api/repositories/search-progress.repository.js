'use strict';

/**
 * Per-search checkpoints for a collection job.
 *
 * A COMPLETED row means the query was verified, extracted and imported. Any
 * other status is retryable, so a resumed job repeats only unfinished work.
 */

const STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

const SELECT = Object.freeze({
  id: true,
  jobId: true,
  firstName: true,
  lastName: true,
  status: true,
  rowCount: true,
  recordsInserted: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
});

function searchKey(search) {
  return `${search.firstName}\u0000${search.lastName}`;
}

function createSearchProgressRepository(prisma) {
  const delegate = () => prisma.collectionSearchProgress;
  let repository;

  repository = {
    /**
     * Creates missing checkpoints for a plan. Existing rows are left untouched
     * so resume never loses a COMPLETED search.
     */
    async ensureMany(jobId, searches) {
      if (!Array.isArray(searches) || searches.length === 0) {
        return 0;
      }

      const result = await delegate().createMany({
        data: searches.map((search) => ({
          jobId,
          firstName: search.firstName,
          lastName: search.lastName,
          status: STATUS.PENDING,
        })),
        skipDuplicates: true,
      });

      return result.count;
    },

    async listForJob(jobId) {
      return delegate().findMany({
        where: { jobId },
        orderBy: { createdAt: 'asc' },
        select: SELECT,
      });
    },

    /** Returns every checkpoint that has not already succeeded. */
    async listPending(jobId) {
      const rows = await repository.listForJob(jobId);
      return rows.filter((row) => row.status !== STATUS.COMPLETED);
    },

    async markRunning(id) {
      return delegate().update({
        where: { id },
        data: { status: STATUS.RUNNING, errorMessage: null },
        select: SELECT,
      });
    },

    async markCompleted(id, { rowCount, recordsInserted }) {
      return delegate().update({
        where: { id },
        data: {
          status: STATUS.COMPLETED,
          rowCount: Number(rowCount) || 0,
          recordsInserted: Number(recordsInserted) || 0,
          errorMessage: null,
        },
        select: SELECT,
      });
    },

    async markFailed(id, message) {
      return delegate().update({
        where: { id },
        data: {
          status: STATUS.FAILED,
          errorMessage: String(message).slice(0, 2000),
        },
        select: SELECT,
      });
    },

    /** Exposed for tests that need to match a plan search to its checkpoint. */
    key: searchKey,
  };

  return repository;
}

module.exports = { STATUS, createSearchProgressRepository };
