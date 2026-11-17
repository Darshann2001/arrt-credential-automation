'use strict';

/**
 * Field validation for extracted records.
 *
 * These validators are intentionally separate from `name.validator.js` because
 * directory rows use display formats such as "Smith, John Jr." that the search
 * name validator does not accept. Credential validation only checks that a
 * non-empty, printable value exists; it does NOT assume an ARRT format.
 */

const { isRecognizedState } = require('./field-normalizer');

const FULL_NAME_MAX_LENGTH = 120;
const CITY_MAX_LENGTH = 80;
const CREDENTIAL_MAX_LENGTH = 100;

const LETTER_PATTERN = /\p{L}/u;
const ALLOWED_NAME_PATTERN = /^[\p{L}\p{M}\s.'’\-,]+$/u;
const ALLOWED_CITY_PATTERN = /^[\p{L}\p{M}\s.'’\-,]+$/u;
const PRINTABLE_PATTERN = /^[^\u0000-\u001F\u007F]+$/u;

/**
 * @param {string} value
 * @returns {object[]}
 */
function validateFullName(value) {
  if (typeof value !== 'string' || !value) {
    return [
      error(
        'MISSING_FULL_NAME',
        'fullName',
        'fullName is required and must be a non-empty string.'
      ),
    ];
  }

  if (value.length > FULL_NAME_MAX_LENGTH) {
    return [
      error(
        'INVALID_FULL_NAME',
        'fullName',
        `fullName must be at most ${FULL_NAME_MAX_LENGTH} characters, received ${value.length}.`,
        value
      ),
    ];
  }

  if (!LETTER_PATTERN.test(value) || !ALLOWED_NAME_PATTERN.test(value)) {
    return [
      error(
        'INVALID_FULL_NAME',
        'fullName',
        'fullName must contain at least one letter and may only contain letters, spaces, periods, apostrophes, hyphens and commas.',
        value
      ),
    ];
  }

  return [];
}

/**
 * @param {string} value
 * @returns {object[]}
 */
function validateCity(value) {
  if (typeof value !== 'string' || !value) {
    return [
      error(
        'MISSING_CITY',
        'city',
        'city is required and must be a non-empty string.'
      ),
    ];
  }

  if (value.length > CITY_MAX_LENGTH) {
    return [
      error(
        'INVALID_CITY',
        'city',
        `city must be at most ${CITY_MAX_LENGTH} characters, received ${value.length}.`,
        value
      ),
    ];
  }

  if (!LETTER_PATTERN.test(value) || !ALLOWED_CITY_PATTERN.test(value)) {
    return [
      error(
        'INVALID_CITY',
        'city',
        'city must contain at least one letter and may only contain letters, spaces, periods, apostrophes, hyphens and commas.',
        value
      ),
    ];
  }

  return [];
}

/**
 * Validates a state without discarding unfamiliar values. Unknown states are
 * reported as INVALID_STATE and the original value stays on the rejected row.
 *
 * @param {string} value
 * @returns {object[]}
 */
function validateState(value) {
  if (typeof value !== 'string' || !value) {
    return [
      error(
        'MISSING_STATE',
        'state',
        'state is required and must be a non-empty string.'
      ),
    ];
  }

  if (!isRecognizedState(value)) {
    return [
      error(
        'INVALID_STATE',
        'state',
        'state must be a recognized U.S. state, territory or military postal code (two-letter code or full name).',
        value
      ),
    ];
  }

  return [];
}

/**
 * Validates a credential string without assuming any credential format.
 *
 * @param {string} value
 * @returns {object[]}
 */
function validateCredentialString(value) {
  if (typeof value !== 'string' || !value) {
    return [
      error(
        'MISSING_CREDENTIAL',
        'credentialString',
        'credentialString is required and must be a non-empty string.'
      ),
    ];
  }

  if (value.length > CREDENTIAL_MAX_LENGTH) {
    return [
      error(
        'INVALID_CREDENTIAL',
        'credentialString',
        `credentialString must be at most ${CREDENTIAL_MAX_LENGTH} characters, received ${value.length}.`,
        value
      ),
    ];
  }

  if (!PRINTABLE_PATTERN.test(value)) {
    return [
      error(
        'INVALID_CREDENTIAL',
        'credentialString',
        'credentialString must not contain control characters.',
        value
      ),
    ];
  }

  return [];
}

/**
 * Validates all required extracted fields and returns every problem found.
 *
 * @param {object} values
 * @returns {{ code: string, field: string, message: string, value?: unknown }[]}
 */
function validateRecordValues(values = {}) {
  return [
    ...validateFullName(values.fullName),
    ...validateCity(values.city),
    ...validateState(values.state),
    ...validateCredentialString(values.credentialString),
  ];
}

function error(code, field, message, value) {
  const result = { code, field, message };
  if (value !== undefined) {
    result.value = value;
  }
  return result;
}

module.exports = {
  FULL_NAME_MAX_LENGTH,
  CITY_MAX_LENGTH,
  CREDENTIAL_MAX_LENGTH,
  validateFullName,
  validateCity,
  validateState,
  validateCredentialString,
  validateRecordValues,
};
