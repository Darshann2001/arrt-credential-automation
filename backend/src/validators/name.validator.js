'use strict';

/**
 * Name validation.
 *
 * Valid rules:
 * - Names must contain at least one letter.
 * - Allowed characters: Unicode letters, combining marks, spaces, hyphens,
 *   apostrophes and periods (e.g. "O'Brien", "Smith-Jones", "St. John").
 * - `*` is the only wildcard character. It may be disabled per call.
 * - Values are trimmed and whitespace-normalized before being returned.
 */

const { normalizeName, toNameList } = require('../utils/name-normalizer.util');
const { MAX_WILDCARD_COUNT } = require('../utils/wildcard.util');

const DEFAULT_MAX_LENGTH = 50;
const ALLOWED_PATTERN = /^[\p{L}\p{M}\s'.-]+$/u;
const ALLOWED_CHARACTER = /[\p{L}\p{M}\s'.-]/u;
const LETTER_PATTERN = /[\p{L}\p{M}]/u;

/**
 * Error thrown by the assertion-style validators.
 */
class NameValidationError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string} [details.code]
   * @param {string} [details.field]
   * @param {unknown} [details.value]
   * @param {object[]} [details.errors]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'NameValidationError';
    this.code = details.code || 'INVALID_NAME';
    this.field = details.field || 'name';
    this.value = details.value;
    this.errors = details.errors || [];
  }
}

/**
 * Validates a single name or wildcard pattern without throwing.
 *
 * @param {unknown} value
 * @param {object} [options]
 * @param {string} [options.field='name'] Label used in error messages.
 * @param {number} [options.maxLength=50] Maximum normalized length.
 * @param {boolean} [options.allowWildcards=true]
 * @param {boolean} [options.allowBareWildcard=false] Allow a pattern that is
 *   only `*` characters.
 * @returns {{ valid: boolean, value: string, errors: { code: string, message: string }[] }}
 */
function validateName(value, options = {}) {
  const {
    field = 'name',
    maxLength = DEFAULT_MAX_LENGTH,
    allowWildcards = true,
    allowBareWildcard = false,
  } = options;
  const label = formatField(field);

  if (typeof value !== 'string') {
    return {
      valid: false,
      value: '',
      errors: [
        {
          code: 'INVALID_TYPE',
          message: `${label} must be a string, received ${
            value === null ? 'null' : `type "${typeof value}"`
          }.`,
        },
      ],
    };
  }

  const normalized = normalizeName(value);
  const errors = [];

  if (!normalized) {
    errors.push({
      code: 'EMPTY_INPUT',
      message: `${label} must not be empty.`,
    });
    return { valid: false, value: '', errors };
  }

  if (normalized.length > maxLength) {
    errors.push({
      code: 'TOO_LONG',
      message: `${label} must be at most ${maxLength} characters, received ${normalized.length}.`,
    });
  }

  const wildcardCount = normalized.split('*').length - 1;

  if (!allowWildcards && wildcardCount > 0) {
    errors.push({
      code: 'WILDCARD_NOT_ALLOWED',
      message: `${label} must not contain wildcards ("*").`,
    });
  } else if (allowWildcards && wildcardCount > MAX_WILDCARD_COUNT) {
    errors.push({
      code: 'WILDCARD_TOO_COMPLEX',
      message: `${label} must contain at most ${MAX_WILDCARD_COUNT} wildcards, received ${wildcardCount}.`,
    });
  }

  // Remove wildcards before character checks so "*" is only reported once
  // (as WILDCARD_NOT_ALLOWED / BARE_WILDCARD) instead of also being flagged as
  // an invalid character or a missing letter.
  const candidate = normalized.replace(/\*/g, '');

  if (!candidate) {
    if (allowWildcards && !allowBareWildcard) {
      errors.push({
        code: 'BARE_WILDCARD',
        message: `${label} must contain at least one non-wildcard character.`,
      });
    }
  } else if (!ALLOWED_PATTERN.test(candidate)) {
    const invalidCharacters = [...new Set([...candidate])].filter(
      (character) => !ALLOWED_CHARACTER.test(character)
    );
    errors.push({
      code: 'INVALID_CHARACTERS',
      message: `${label} contains invalid character(s): ${invalidCharacters
        .map((character) => JSON.stringify(character))
        .join(', ')}. Allowed: letters, spaces, hyphens, apostrophes and periods${
        allowWildcards ? ', plus "*" as a wildcard' : ''
      }.`,
    });
  } else if (!LETTER_PATTERN.test(candidate)) {
    // Avoid double-reporting malformed values that already contain invalid
    // characters; REQUIRES_LETTER is for otherwise-allowed punctuation only.
    errors.push({
      code: 'REQUIRES_LETTER',
      message: `${label} must contain at least one letter.`,
    });
  }

  return {
    valid: errors.length === 0,
    value: normalized,
    errors,
  };
}

/**
 * Assertion-style single-name validation. Throws a descriptive
 * {@link NameValidationError} when invalid and returns the normalized value
 * when valid.
 *
 * @param {unknown} value
 * @param {object} [options]
 * @returns {string}
 */
function assertValidName(value, options = {}) {
  const result = validateName(value, options);
  if (!result.valid) {
    throw buildListError(result.errors, value, options.field);
  }

  return result.value;
}

/**
 * Validates a list of names (or a comma/newline separated string) without
 * throwing.
 *
 * @param {unknown} input
 * @param {object} [options] Same options as {@link validateName}.
 * @returns {{ valid: boolean, names: string[], errors: object[] }}
 */
function validateNameList(input, options = {}) {
  const field = options.field || 'name';
  const label = formatField(field);

  let rawNames;
  try {
    rawNames = toNameList(input);
  } catch (error) {
    return {
      valid: false,
      names: [],
      errors: [
        {
          index: null,
          code: 'INVALID_TYPE',
          message: `${label} list is invalid: ${error.message}`,
          value: input,
        },
      ],
    };
  }

  if (rawNames.length === 0) {
    return {
      valid: false,
      names: [],
      errors: [
        {
          index: null,
          code: 'EMPTY_INPUT',
          message: `At least one ${label} is required.`,
          value: input,
        },
      ],
    };
  }

  const names = [];
  const errors = [];

  rawNames.forEach((rawName, index) => {
    const result = validateName(rawName, { ...options, field });
    if (result.valid) {
      names.push(result.value);
    } else {
      errors.push({
        index,
        value: rawName,
        code: result.errors[0].code,
        message: `Entry ${index + 1}: ${result.errors
          .map((error) => error.message)
          .join(' ')}`,
        errors: result.errors,
      });
    }
  });

  return { valid: errors.length === 0, names, errors };
}

/**
 * Assertion-style list validation. Throws when any entry is invalid.
 *
 * @param {unknown} input
 * @param {object} [options]
 * @returns {string[]} Normalized names (duplicates are NOT removed here).
 */
function assertValidNameList(input, options = {}) {
  const result = validateNameList(input, options);
  if (!result.valid) {
    const summary = result.errors.map((error) => error.message).join(' ');
    throw new NameValidationError(
      `Invalid ${formatField(options.field || 'name')} list: ${summary}`,
      {
        code: result.errors[0].code,
        field: options.field || 'name',
        value: input,
        errors: result.errors,
      }
    );
  }

  return result.names;
}

function buildListError(errors, value, field = 'name') {
  const summary = errors.map((error) => error.message).join(' ');
  return new NameValidationError(
    `Invalid ${formatField(field)} ${JSON.stringify(value)}: ${summary}`,
    {
      code: errors[0].code,
      field,
      value,
      errors,
    }
  );
}

function formatField(field) {
  return String(field)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

module.exports = {
  DEFAULT_MAX_LENGTH,
  NameValidationError,
  validateName,
  assertValidName,
  validateNameList,
  assertValidNameList,
};
