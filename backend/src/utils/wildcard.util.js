'use strict';

/**
 * Safe wildcard matching.
 *
 * Application-level wildcard rules:
 * - `*` matches zero or more characters.
 * - Matching is case-insensitive by default.
 * - Every other character is matched literally (regex metacharacters are
 *   escaped), so a name such as "St. John" can never alter a regex.
 *
 * `matchesWildcard()` and `findMatchingNames()` use a bounded, greedy
 * two-pointer matcher instead of a regular expression. This removes the
 * catastrophic-backtracking risk of patterns such as `a*a*a*a*a*b`.
 *
 * `wildcardToRegExp()` is kept for compatibility and for callers that need a
 * RegExp object. Because JavaScript regexes backtrack, that helper only accepts
 * patterns with at most 4 wildcards and should not be used for untrusted input.
 *
 * The ARRT website is NOT assumed to support `*`. These patterns are only a
 * local search plan; the automation layer decides how to translate them.
 */

const { normalizeWhitespace } = require('./name-normalizer.util');

const WILDCARD = '*';
const REGEX_SPECIAL_CHARACTERS = /[.+?^${}()|[\]\\]/g;
const MAX_PATTERN_LENGTH = 100;
const MAX_WILDCARD_COUNT = 8;
const MAX_REGEX_WILDCARDS = 4;

/**
 * Validates and normalizes a wildcard pattern (whitespace + repeated `*`).
 *
 * @param {string} pattern
 * @returns {string}
 */
function normalizeWildcardPattern(pattern) {
  if (typeof pattern !== 'string') {
    throw new TypeError(
      `Wildcard pattern must be a string, received ${pattern === null ? 'null' : `type "${typeof pattern}"`}.`
    );
  }

  const normalized = normalizeWhitespace(pattern);
  if (!normalized) {
    throw new Error('Wildcard pattern must not be empty.');
  }

  if (normalized.length > MAX_PATTERN_LENGTH) {
    throw new RangeError(
      `Wildcard pattern must be at most ${MAX_PATTERN_LENGTH} characters, received ${normalized.length}.`
    );
  }

  return normalized.replace(/\*{2,}/g, WILDCARD);
}

/**
 * Counts wildcard characters in a pattern after normalization.
 *
 * @param {string} pattern
 * @returns {number}
 */
function countWildcards(pattern) {
  return normalizeWildcardPattern(pattern).split(WILDCARD).length - 1;
}

/**
 * Escapes characters that have a special meaning in a regular expression.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(REGEX_SPECIAL_CHARACTERS, '\\$&');
}

/**
 * Converts a wildcard pattern into an anchored, case-insensitive RegExp.
 *
 * Guarded to at most {@link MAX_REGEX_WILDCARDS} wildcards because adjacent
 * `.*` groups backtrack badly. Prefer {@link matchesWildcard} for matching.
 *
 * @param {string} pattern Wildcard pattern such as "A*" or "Chris*".
 * @param {object} [options]
 * @param {boolean} [options.caseInsensitive=true]
 * @param {boolean} [options.prefix=false] Treat a pattern without a trailing
 *   `*` as a prefix match (e.g. "Chris" -> /^Chris.*$/i).
 * @returns {RegExp}
 */
function wildcardToRegExp(pattern, options = {}) {
  const { caseInsensitive = true, prefix = false } = options;
  const normalized = normalizeWildcardPattern(pattern);
  const wildcardCount = normalized.split(WILDCARD).length - 1;

  if (wildcardCount > MAX_REGEX_WILDCARDS) {
    throw new RangeError(
      `Pattern contains ${wildcardCount} wildcards; wildcardToRegExp supports at most ` +
        `${MAX_REGEX_WILDCARDS}. Use matchesWildcard() for complex or untrusted patterns.`
    );
  }

  const source = normalized
    .split(WILDCARD)
    .map(escapeRegex)
    .join('.*');

  const prefixSource =
    prefix && !normalized.endsWith(WILDCARD) ? `${source}.*` : source;

  return new RegExp(`^${prefixSource}$`, caseInsensitive ? 'i' : '');
}

/**
 * Matches an already-normalized pattern against a value using a greedy
 * two-pointer algorithm. This is polynomial (no exponential backtracking) and
 * bounded by the configured pattern/value lengths.
 *
 * @param {string} value
 * @param {string} normalizedPattern
 * @param {object} [options]
 * @param {boolean} [options.caseInsensitive=true]
 * @param {boolean} [options.prefix=false]
 * @returns {boolean}
 */
function matchNormalizedWildcard(value, normalizedPattern, options = {}) {
  const { caseInsensitive = true, prefix = false } = options;

  let pattern =
    prefix && !normalizedPattern.endsWith(WILDCARD)
      ? `${normalizedPattern}${WILDCARD}`
      : normalizedPattern;
  let candidate = normalizeWhitespace(value);

  if (caseInsensitive) {
    pattern = pattern.toLowerCase();
    candidate = candidate.toLowerCase();
  }

  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let starMatchIndex = 0;

  while (valueIndex < candidate.length) {
    if (
      patternIndex < pattern.length &&
      pattern[patternIndex] === WILDCARD
    ) {
      starIndex = patternIndex;
      starMatchIndex = valueIndex;
      patternIndex += 1;
    } else if (
      patternIndex < pattern.length &&
      pattern[patternIndex] === candidate[valueIndex]
    ) {
      patternIndex += 1;
      valueIndex += 1;
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      starMatchIndex += 1;
      valueIndex = starMatchIndex;
    } else {
      return false;
    }
  }

  while (
    patternIndex < pattern.length &&
    pattern[patternIndex] === WILDCARD
  ) {
    patternIndex += 1;
  }

  return patternIndex === pattern.length;
}

/**
 * Tests a value against a wildcard pattern using the bounded matcher.
 *
 * @param {string} value
 * @param {string} pattern
 * @param {object} [options] Same options as {@link wildcardToRegExp}.
 * @returns {boolean}
 */
function matchesWildcard(value, pattern, options = {}) {
  if (typeof value !== 'string') {
    return false;
  }

  return matchNormalizedWildcard(
    normalizeWhitespace(value),
    normalizeWildcardPattern(pattern),
    options
  );
}

/**
 * Alias for {@link matchesWildcard}; kept as an explicit name for consumers
 * that want to make it obvious no RegExp is used.
 *
 * @type {(value: string, pattern: string, options?: object) => boolean}
 */
function wildcardMatch(value, pattern, options = {}) {
  return matchesWildcard(value, pattern, options);
}

/**
 * Returns true when a pattern contains at least one wildcard character.
 *
 * @param {string} pattern
 * @returns {boolean}
 */
function hasWildcard(pattern) {
  return typeof pattern === 'string' && pattern.includes(WILDCARD);
}

/**
 * Finds names matching any of the supplied wildcard patterns.
 * Input order is preserved and duplicate names are removed
 * (case-insensitively). Uses the bounded matcher, never RegExp.
 *
 * @param {string[]} names
 * @param {string[]} patterns
 * @param {object} [options] Same options as {@link wildcardToRegExp}.
 * @returns {string[]}
 */
function findMatchingNames(names, patterns, options = {}) {
  if (!Array.isArray(names)) {
    throw new TypeError('Names must be provided as an array.');
  }
  if (!Array.isArray(patterns)) {
    throw new TypeError('Patterns must be provided as an array.');
  }

  const uniquePatterns = [
    ...new Set(patterns.map((pattern) => normalizeWildcardPattern(pattern))),
  ];

  const seen = new Set();
  const matches = [];

  for (const name of names) {
    if (typeof name !== 'string') {
      continue;
    }

    const normalized = normalizeWhitespace(name);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    const isMatch = uniquePatterns.some((pattern) =>
      matchNormalizedWildcard(normalized, pattern, options)
    );

    if (isMatch) {
      seen.add(key);
      matches.push(normalized);
    }
  }

  return matches;
}

module.exports = {
  WILDCARD,
  MAX_PATTERN_LENGTH,
  MAX_WILDCARD_COUNT,
  MAX_REGEX_WILDCARDS,
  normalizeWildcardPattern,
  countWildcards,
  escapeRegex,
  wildcardToRegExp,
  matchNormalizedWildcard,
  matchesWildcard,
  wildcardMatch,
  hasWildcard,
  findMatchingNames,
};
