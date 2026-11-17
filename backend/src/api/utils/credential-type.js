'use strict';

/**
 * Best-effort credential-type derivation for dashboard grouping.
 *
 * ARRT credential strings have not been fully catalogued, so this is a
 * structural derivation, not an authoritative classification:
 *   1. a parenthesised discipline token, e.g. "R.T.(R)(CT)" -> "R";
 *   2. otherwise the leading alphabetic token, e.g. "RT-123" -> "RT";
 *   3. otherwise the leading alphanumeric token;
 *   4. otherwise "UNKNOWN".
 *
 * The raw credential string is never altered or re-formatted for storage.
 */

const UNKNOWN = 'UNKNOWN';

/**
 * @param {unknown} credentialString
 * @returns {string}
 */
function deriveCredentialType(credentialString) {
  const text = String(credentialString ?? '').trim().toUpperCase();

  if (!text) {
    return UNKNOWN;
  }

  const discipline = text.match(/\(([A-Z]{1,4})\)/);
  if (discipline) {
    return discipline[1];
  }

  const leadingLetters = text.match(/^[A-Z]+/);
  if (leadingLetters) {
    return leadingLetters[0];
  }

  const leadingAlphanumeric = text.match(/^[A-Z0-9]+/);
  if (leadingAlphanumeric) {
    return leadingAlphanumeric[0];
  }

  return UNKNOWN;
}

/**
 * Groups credential strings by derived type.
 *
 * @param {string[]} credentialStrings
 * @returns {{ credentialType: string, count: number }[]}
 */
function groupByCredentialType(credentialStrings) {
  const counts = new Map();

  for (const value of credentialStrings) {
    const type = deriveCredentialType(value);
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([credentialType, count]) => ({ credentialType, count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.credentialType.localeCompare(right.credentialType)
    );
}

module.exports = {
  UNKNOWN_CREDENTIAL_TYPE: UNKNOWN,
  deriveCredentialType,
  groupByCredentialType,
};
