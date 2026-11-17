'use strict';

const { groupByCredentialType } = require('../utils/credential-type');

const DEFAULT_RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ recordRepository: object, jobRepository: object }} deps
 */
function createDashboardService({ recordRepository, jobRepository }) {
  return {
    /**
     * @param {{ recentDays?: number }} [options]
     */
    async getStats({ recentDays = DEFAULT_RECENT_DAYS } = {}) {
      const since = new Date(Date.now() - recentDays * DAY_MS);

      const [
        totalRecords,
        totalJobs,
        completedJobs,
        failedJobs,
        recentRecords,
        recordsByState,
        credentialStrings,
      ] = await Promise.all([
        recordRepository.count(),
        jobRepository.count(),
        jobRepository.countByStatus('COMPLETED'),
        jobRepository.countByStatus('FAILED'),
        recordRepository.countCreatedSince(since),
        recordRepository.countByState(),
        recordRepository.listCredentialStrings(),
      ]);

      return {
        totalRecords,
        totalJobs,
        completedJobs,
        failedJobs,
        recordsAddedRecently: {
          windowDays: recentDays,
          since: since.toISOString(),
          count: recentRecords,
        },
        recordsByState,
        recordsByCredentialType: groupByCredentialType(credentialStrings),
      };
    },
  };
}

module.exports = {
  DEFAULT_RECENT_DAYS,
  createDashboardService,
};
