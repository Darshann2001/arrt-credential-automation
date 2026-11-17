'use strict';

/**
 * Public entry point for the ARRT name search generator.
 *
 * Usage:
 *   const { generateCombinations } = require('./src');
 *   const result = generateCombinations({
 *     firstNames: ['Chris', 'Christian'],
 *     lastNames: ['Adams', 'Anderson'],
 *   });
 */

const wildcardUtil = require('./utils/wildcard.util');
const nameNormalizer = require('./utils/name-normalizer.util');
const nameValidator = require('./validators/name.validator');
const nameGenerator = require('./services/name-generator.service');
const extraction = require('./extraction');
const automation = require('./automation');

module.exports = {
  // Wildcard utilities
  WILDCARD: wildcardUtil.WILDCARD,
  MAX_PATTERN_LENGTH: wildcardUtil.MAX_PATTERN_LENGTH,
  MAX_WILDCARD_COUNT: wildcardUtil.MAX_WILDCARD_COUNT,
  MAX_REGEX_WILDCARDS: wildcardUtil.MAX_REGEX_WILDCARDS,
  normalizeWildcardPattern: wildcardUtil.normalizeWildcardPattern,
  countWildcards: wildcardUtil.countWildcards,
  escapeRegex: wildcardUtil.escapeRegex,
  wildcardToRegExp: wildcardUtil.wildcardToRegExp,
  matchNormalizedWildcard: wildcardUtil.matchNormalizedWildcard,
  matchesWildcard: wildcardUtil.matchesWildcard,
  wildcardMatch: wildcardUtil.wildcardMatch,
  hasWildcard: wildcardUtil.hasWildcard,
  findMatchingNames: wildcardUtil.findMatchingNames,

  // Normalization utilities
  toNameList: nameNormalizer.toNameList,
  normalizeWhitespace: nameNormalizer.normalizeWhitespace,
  normalizeName: nameNormalizer.normalizeName,
  toNameKey: nameNormalizer.toNameKey,
  dedupeNames: nameNormalizer.dedupeNames,
  sortNames: nameNormalizer.sortNames,

  // Validation
  DEFAULT_MAX_LENGTH: nameValidator.DEFAULT_MAX_LENGTH,
  NameValidationError: nameValidator.NameValidationError,
  validateName: nameValidator.validateName,
  assertValidName: nameValidator.assertValidName,
  validateNameList: nameValidator.validateNameList,
  assertValidNameList: nameValidator.assertValidNameList,

  // Generation
  DEFAULT_ALPHABET: nameGenerator.DEFAULT_ALPHABET,
  DEFAULT_MAX_COMBINATIONS: nameGenerator.DEFAULT_MAX_COMBINATIONS,
  generateCombinations: nameGenerator.generateCombinations,
  generateAlphabetPatterns: nameGenerator.generateAlphabetPatterns,

  // Step 2: fixture-driven HTML extraction
  ...extraction,

  // Step 3: automation scaffolding (mock/offline; live ARRT access gated)
  ...automation,
};

// Runnable demo: `npm start` (does not run when the module is required).
if (require.main === module) {
  const example = module.exports.generateCombinations({
    firstNames: ['Chris', 'Christian'],
    lastNames: ['Adams', 'Anderson'],
  });
  const patterns = module.exports.generateAlphabetPatterns();

  console.log('ARRT name search combinations');
  console.log(JSON.stringify(example, null, 2));
  console.log(
    `Alphabetical patterns (${patterns.length}): ${patterns.join(', ')}`
  );
}
