'use strict';

/**
 * Collection job and job log data access.
 */

const PUBLIC_SELECT = Object.freeze({
  id: true,
  status: true,
  source: true,
  requestedTarget: true,
  recordsFound: true,
  recordsInserted: true,
  recordsSkipped: true,
  recordsRejected: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
});

const LOG_SELECT = Object.freeze({
  id: true,
  jobId: true,
  level: true,
  message: true,
  createdAt: true,
});

/**
 * @param {object} prisma
 */
function createJobRepository(prisma) {
  return {
    /**
     * Creates a job and its first log entry atomically.
     *
     * @param {{ source: string, requestedTarget: number, message: string }} input
     * @returns {Promise<object>}
     */
    async createWithLog({ source, requestedTarget, message }) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.collectionJob.create({
          data: {
            status: 'PENDING',
            source,
            requestedTarget,
          },
          select: PUBLIC_SELECT,
        });

        await tx.collectionJobLog.create({
          data: {
            jobId: job.id,
            level: 'INFO',
            message,
          },
        });

        return job;
      });
    },

    /**
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async findById(id) {
      return prisma.collectionJob.findUnique({
        where: { id },
        select: PUBLIC_SELECT,
      });
    },

    /**
     * @param {string} id
     * @returns {Promise<(object & { logs: object[] })|null>}
     */
    async findByIdWithLogs(id) {
      return prisma.collectionJob.findUnique({
        where: { id },
        select: {
          ...PUBLIC_SELECT,
          logs: {
            select: LOG_SELECT,
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    },

    /**
     * @param {{ status?: string, skip: number, take: number }} params
     * @returns {Promise<{ total: number, rows: object[] }>}
     */
    async list({ status, skip, take }) {
      const where = status ? { status } : {};

      const [total, rows] = await Promise.all([
        prisma.collectionJob.count({ where }),
        prisma.collectionJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: PUBLIC_SELECT,
        }),
      ]);

      return { total, rows };
    },

    async count() {
      return prisma.collectionJob.count();
    },

    /**
     * @param {string} status
     */
    async countByStatus(status) {
      return prisma.collectionJob.count({ where: { status } });
    },

    /**
     * Applies import counters to a job and appends a log entry.
     *
     * @param {string} jobId
     * @param {{ found: number, inserted: number, skipped: number, rejected: number }} counts
     * @param {string} message
     * @returns {Promise<object|null>}
     */
    async addProgress(jobId, counts, message) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.collectionJob.update({
          where: { id: jobId },
          data: {
            recordsFound: { increment: counts.found },
            recordsInserted: { increment: counts.inserted },
            recordsSkipped: { increment: counts.skipped },
            recordsRejected: { increment: counts.rejected },
          },
          select: PUBLIC_SELECT,
        });

        await tx.collectionJobLog.create({
          data: {
            jobId,
            level: counts.rejected > 0 ? 'WARN' : 'INFO',
            message,
          },
        });

        return job;
      });
    },

    async markRunning(jobId) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.collectionJob.update({
          where: { id: jobId },
          data: { status: 'RUNNING', startedAt: new Date() },
          select: PUBLIC_SELECT,
        });

        await tx.collectionJobLog.create({
          data: { jobId, level: 'INFO', message: 'Live collection started.' },
        });

        return job;
      });
    },

    async markCompleted(jobId) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.collectionJob.update({
          where: { id: jobId },
          data: { status: 'COMPLETED', completedAt: new Date() },
          select: PUBLIC_SELECT,
        });

        await tx.collectionJobLog.create({
          data: { jobId, level: 'INFO', message: 'Live collection completed.' },
        });

        return job;
      });
    },

    async markFailed(jobId, message) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.collectionJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: String(message).slice(0, 2000),
          },
          select: PUBLIC_SELECT,
        });

        await tx.collectionJobLog.create({
          data: {
            jobId,
            level: 'ERROR',
            message: `Live collection failed: ${String(message).slice(0, 1000)}`,
          },
        });

        return job;
      });
    },

    async appendLog(jobId, level, message) {
      return prisma.collectionJobLog.create({
        data: { jobId, level, message: String(message).slice(0, 2000) },
        select: LOG_SELECT,
      });
    },
  };
}

module.exports = {
  PUBLIC_JOB_SELECT: PUBLIC_SELECT,
  createJobRepository,
};
