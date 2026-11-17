'use strict';

/**
 * Small coercion helpers for optional string filters.
 */

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

module.exports = { optionalText };
