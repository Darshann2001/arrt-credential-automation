'use strict';

/**
 * Field normalization for extracted records.
 *
 * Normalization is deliberately conservative:
 * - whitespace is collapsed and trimmed,
 * - typographic apostrophes/dashes are normalized for names and places,
 * - recognized U.S. state names are mapped to their postal code,
 * - unrecognized state values are preserved verbatim (after trimming) so they
 *   can be reported as INVALID_STATE instead of being silently discarded,
 * - credential strings are NOT reformatted. Only whitespace is normalized;
 *   no credential format is inferred or invented.
 */

const {
  normalizeName,
  normalizeWhitespace,
} = require('../utils/name-normalizer.util');

const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;

const US_STATE_ENTRIES = Object.freeze([
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
  ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands'],
  ['GU', 'Guam'],
  ['AS', 'American Samoa'],
  ['MP', 'Northern Mariana Islands'],
  ['AA', 'Armed Forces Americas'],
  ['AE', 'Armed Forces Europe'],
  ['AP', 'Armed Forces Pacific'],
]);

const STATE_CODES = Object.freeze(
  new Set(US_STATE_ENTRIES.map(([code]) => code))
);

const STATE_NAME_TO_CODE = Object.freeze(
  new Map(
    US_STATE_ENTRIES.map(([code, name]) => [stateLookupKey(name), code])
  )
);

/**
 * @param {unknown} value
 * @returns {string} Trimmed text with collapsed whitespace and no zero-width
 *   characters. `null`/`undefined` become an empty string.
 */
function normalizeText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return normalizeWhitespace(String(value).replace(ZERO_WIDTH_PATTERN, ''));
}

/**
 * Normalizes a display/credential-holder name.
 *
 * Comma-separated ("Smith, John") and suffix forms ("Smith, John Jr.") are
 * preserved. Spaces around the comma are made consistent.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeFullName(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  return normalizeName(text).replace(/\s*,\s*/g, ', ');
}

/**
 * Normalizes a city/town value.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCity(value) {
  const text = normalizeText(value);
  return text ? normalizeName(text) : '';
}

/**
 * Normalizes a U.S. state value.
 *
 * Recognized postal codes and full state names are converted to the two-letter
 * postal code. Unrecognized values are returned as trimmed input so callers can
 * preserve and report them.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeState(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const lookup = stateLookupKey(text);
  const codeCandidate = lookup.toUpperCase();

  if (STATE_CODES.has(codeCandidate)) {
    return codeCandidate;
  }

  const mapped = STATE_NAME_TO_CODE.get(lookup);
  return mapped || text;
}

/**
 * Normalizes a credential string without inferring any credential format.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCredentialString(value) {
  return normalizeText(value);
}

/**
 * Normalizes an optional source record identifier.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRecordId(value) {
  return normalizeText(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRecognizedState(value) {
  const normalized = normalizeState(value);
  return STATE_CODES.has(normalized);
}

/**
 * @param {string} value
 * @returns {string}
 */
function stateLookupKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a raw row from the row extractor.
 *
 * @param {object} values
 * @param {unknown} [values.fullName]
 * @param {unknown} [values.city]
 * @param {unknown} [values.state]
 * @param {unknown} [values.credentialString]
 * @param {unknown} [values.recordId]
 * @returns {{ fullName: string, city: string, state: string, credentialString: string, recordId: string }}
 */
function normalizeRecordValues(values = {}) {
  return {
    fullName: normalizeFullName(values.fullName),
    city: normalizeCity(values.city),
    state: normalizeState(values.state),
    credentialString: normalizeCredentialString(values.credentialString),
    recordId: normalizeRecordId(values.recordId),
  };
}

module.exports = {
  US_STATE_ENTRIES,
  STATE_CODES,
  normalizeText,
  normalizeFullName,
  normalizeCity,
  normalizeState,
  normalizeCredentialString,
  normalizeRecordId,
  normalizeRecordValues,
  isRecognizedState,
};
