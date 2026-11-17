'use strict';

/**
 * Name normalization helpers.
 *
 * All public helpers are pure functions so they can be unit tested and reused
 * by validators, the generator service and the future automation engine.
 */

// Covers ASCII whitespace plus common Unicode space characters.
const WHITESPACE_PATTERN = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

// Common characters people type instead of a plain hyphen/apostrophe.
const HYPHEN_VARIANTS_PATTERN = /[\u2010-\u2015\u2212]/g;
const APOSTROPHE_VARIANTS_PATTERN = /[\u2018\u2019\u02BC\u0060\u00B4]/g;

/**
 * Splits a raw string/list into individual name entries.
 * Accepts a single string, a comma/semicolon/newline separated string, or an
 * array containing any mix of those.
 *
 * @param {string|string[]|null|undefined} input
 * @returns {string[]} Raw, non-empty entries (not yet normalized).
 */
function toNameList(input) {
  if (input === undefined || input === null) {
    return [];
  }

  const items = Array.isArray(input) ? input : [input];
  const entries = [];

  for (const item of items) {
    if (typeof item !== 'string') {
      throw new TypeError(
        `Name input entries must be strings, received ${describeValue(item)}.`
      );
    }

    for (const part of item.split(/[,;\r\n]+/)) {
      const trimmed = part.trim();
      if (trimmed) {
        entries.push(trimmed);
      }
    }
  }

  return entries;
}

/**
 * Collapses repeated whitespace and trims the ends.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected a string, received ${describeValue(value)}.`);
  }

  return value.replace(WHITESPACE_PATTERN, ' ').trim();
}

/**
 * Canonical display form of a name:
 * - collapses/trims whitespace
 * - normalizes curly apostrophes and dash variants
 * - removes spaces around hyphens and apostrophes (e.g. "O' Brien" -> "O'Brien")
 *
 * Letter casing is intentionally preserved because names such as "McDonald"
 * or "van der Berg" carry meaning.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value) {
  return normalizeWhitespace(value)
    .replace(HYPHEN_VARIANTS_PATTERN, '-')
    .replace(APOSTROPHE_VARIANTS_PATTERN, "'")
    .replace(/\s*([-'])\s*/g, '$1');
}

/**
 * Case-insensitive comparison key for a name.
 *
 * @param {string} value
 * @returns {string}
 */
function toNameKey(value) {
  return normalizeName(value).toLowerCase();
}

/**
 * Removes duplicates while keeping the first occurrence (and its casing).
 * Duplicate detection is case-insensitive and whitespace-insensitive.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
function dedupeNames(names) {
  if (!Array.isArray(names)) {
    throw new TypeError(`Expected an array of names, received ${describeValue(names)}.`);
  }

  const seen = new Set();
  const result = [];

  for (const name of names) {
    const normalized = normalizeName(name);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * Case-insensitive alphabetical sort. Returns a new array.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
function sortNames(names) {
  if (!Array.isArray(names)) {
    throw new TypeError(`Expected an array of names, received ${describeValue(names)}.`);
  }

  return [...names].sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  );
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `type "${typeof value}"`;
}

module.exports = {
  toNameList,
  normalizeWhitespace,
  normalizeName,
  toNameKey,
  dedupeNames,
  sortNames,
};
