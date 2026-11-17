'use strict';

/**
 * Import service.
 *
 * Reuses the existing extraction engine's normalizer and validator so imported
 * records obey exactly the same contract as fixture extraction. No extraction
 * or automation module is modified.
 */

const { normalizeRecordValues } = require('../../extraction/field-normalizer');
const { validateRecordValues } = require('../../extraction/field-validator');
const { toNameKey } = require('../../utils/name-normalizer.util');
const { ApiError } = require('../errors/api-error');

const DEFAULT_SOURCE = 'ARRT';
const SOURCE_MAX_LENGTH = 50;

/**
 * @param {unknown} raw
 * @param {string|null} requestSource
 * @returns {{ data: object } | { error: { code: string, field: string|null, message: string } }}
 */
function prepareRecord(raw, requestSource) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      error: {
        code: 'INVALID_RECORD',
        field: null,
        message: 'Each record must be an object.',
      },
    };
  }

  const values = normalizeRecordValues(raw);
  const errors = validateRecordValues(values);

  if (errors.length > 0) {
    return {
      error: {
        code: errors[0].code,
        field: errors[0].field || null,
        message: errors[0].message,
      },
    };
  }

  return {
    data: {
      fullName: values.fullName,
      city: values.city,
      state: values.state,
      credentialString: values.credentialString,
      normalizedName: toNameKey(values.fullName),
      normalizedCity: toNameKey(values.city),
      normalizedState: values.state.toUpperCase(),
      normalizedCredential: values.credentialString.toLowerCase(),
      source: resolveSource(requestSource, raw.source),
      updatedAt: new Date(),
    },
  };
}

/**
 * @param {unknown} requestSource
 * @param {unknown} recordSource
 * @returns {string}
 */
function resolveSource(requestSource, recordSource) {
  for (const candidate of [requestSource, recordSource]) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && trimmed.length <= SOURCE_MAX_LENGTH) {
        return trimmed;
      }
    }
  }

  return DEFAULT_SOURCE;
}

/**
 * @param {{ recordRepository: object, jobRepository: object }} deps
 */
function createImportService({ recordRepository, jobRepository }) {
  return {
    /**
     * @param {{ records: unknown[], source?: string, jobId?: string }} input
     */
    async importRecords({ records, source, jobId }) {
      const prepared = [];
      const rejectedRecords = [];

      records.forEach((raw, index) => {
        const result = prepareRecord(raw, source);

        if (result.error) {
          rejectedRecords.push({ index, ...result.error });
          return;
        }

        prepared.push(result.data);
      });

      const inserted = await recordRepository.createMany(prepared);
      const skipped = prepared.length - inserted;

      const summary = {
        received: records.length,
        inserted,
        skipped,
        rejected: rejectedRecords.length,
        accepted: prepared.length,
        rejectedRecords,
      };

      if (jobId) {
        const job = await jobRepository.findById(jobId);

        if (!job) {
          throw ApiError.notFound('Collection job not found.', 'JOB_NOT_FOUND');
        }

        await jobRepository.addProgress(
          jobId,
          {
            found: records.length,
            inserted,
            skipped,
            rejected: rejectedRecords.length,
          },
          `Imported ${inserted} record(s), skipped ${skipped} duplicate(s), rejected ${rejectedRecords.length} row(s).`
        );

        summary.jobId = jobId;
      }

      return summary;
    },
  };
}

module.exports = {
  DEFAULT_SOURCE,
  prepareRecord,
  resolveSource,
  createImportService,
};
