'use strict';

/**
 * Duplicate detection.
 *
 * Strategy (documented in docs/step-2-extraction.md):
 * 1. When a reliable source record identifier is available, use it alone.
 * 2. Otherwise use a composite key of:
 *      normalized full name + normalized city + normalized state +
 *      normalized credential string.
 *
 * The credential string is never used alone. The composite key is compared
 * case-insensitively after whitespace normalization.
 */

const { toNameKey, normalizeWhitespace } = require('../utils/name-normalizer.util');

const RECORD_ID_STRATEGY = 'record-id';
const COMPOSITE_STRATEGY = 'composite';

/**
 * @param {object} record
 * @returns {{ key: string, strategy: string }}
 */
function buildDedupeKey(record) {
  const recordId = normalizeWhitespace(String(record.recordId || ''));

  if (recordId) {
    return {
      key: `record-id:${recordId.toLowerCase()}`,
      strategy: RECORD_ID_STRATEGY,
    };
  }

  const fullName = toNameKey(record.fullName || '');
  const city = toNameKey(record.city || '');
  const state = normalizeWhitespace(String(record.state || '')).toUpperCase();
  const credential = normalizeWhitespace(
    String(record.credentialString || '')
  ).toLowerCase();

  return {
    key: `composite:${fullName}\u0000${city}\u0000${state}\u0000${credential}`,
    strategy: COMPOSITE_STRATEGY,
  };
}

/**
 * Creates a stateful tracker so duplicates can be detected across pages.
 *
 * @returns {{
 *   check: (record: object) => { duplicate: boolean, key: string, strategy: string, first?: object },
 *   size: () => number
 * }}
 */
function createDuplicateTracker() {
  const seen = new Map();

  return {
    check(record) {
      const { key, strategy } = buildDedupeKey(record);
      const first = seen.get(key);

      if (first) {
        return { duplicate: true, key, strategy, first };
      }

      seen.set(key, record);
      return { duplicate: false, key, strategy };
    },
    size() {
      return seen.size;
    },
  };
}

module.exports = {
  RECORD_ID_STRATEGY,
  COMPOSITE_STRATEGY,
  buildDedupeKey,
  createDuplicateTracker,
};
