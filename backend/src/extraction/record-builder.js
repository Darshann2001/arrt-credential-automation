'use strict';

/**
 * Builds accepted records and rejected-row diagnostics with source provenance.
 */

/**
 * @param {object} values Normalized values.
 * @param {object} provenance
 * @param {string|null} [recordId]
 * @returns {object}
 */
function buildRecord(values, provenance, recordId = null) {
  return {
    fullName: values.fullName,
    city: values.city,
    state: values.state,
    credentialString: values.credentialString,
    recordId: recordId || values.recordId || null,
    source: normalizeProvenance(provenance),
  };
}

/**
 * @param {object[]} errors
 * @param {object} details
 * @param {object} details.rawValues
 * @param {object} details.values
 * @param {object} details.provenance
 * @param {string|null} [details.recordId]
 * @returns {object}
 */
function buildRejectedRow(errors, details) {
  const { rawValues = {}, values = {}, provenance, recordId = null } = details;

  return {
    code: errors[0] ? errors[0].code : 'ROW_REJECTED',
    errors,
    values,
    rawValues,
    recordId: recordId || values.recordId || null,
    source: normalizeProvenance(provenance),
  };
}

/**
 * @param {string} message
 * @param {object} details
 * @param {object} details.rawValues
 * @param {object} details.provenance
 * @returns {object}
 */
function buildMalformedRejection(message, details) {
  const { rawValues = {}, provenance } = details;

  return {
    code: 'MALFORMED_ROW',
    errors: [
      {
        code: 'MALFORMED_ROW',
        field: null,
        message,
      },
    ],
    values: { ...rawValues },
    rawValues: { ...rawValues },
    recordId: null,
    source: normalizeProvenance(provenance),
  };
}

/**
 * @param {object} [provenance]
 * @returns {object}
 */
function normalizeProvenance(provenance = {}) {
  return {
    page: provenance.page ?? null,
    fixture: provenance.fixture ?? null,
    sourceUrl: provenance.sourceUrl ?? null,
    rowNumber: provenance.rowNumber ?? null,
    sourceRowIndex: provenance.sourceRowIndex ?? null,
  };
}

module.exports = {
  buildRecord,
  buildRejectedRow,
  buildMalformedRejection,
  normalizeProvenance,
};
