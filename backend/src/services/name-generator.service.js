'use strict';

/**
 * Search-plan generation service.
 *
 * This module only prepares and validates search inputs. It never contacts
 * ARRT and never performs directory enumeration.
 */

const {
  dedupeNames,
  sortNames,
  toNameKey,
} = require('../utils/name-normalizer.util');
const {
  assertValidNameList,
  validateName,
  NameValidationError,
} = require('../validators/name.validator');

const DEFAULT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_ALPHABET_SEQUENCE_LENGTH = 3;
const DEFAULT_MAX_PATTERNS = 5000;
const DEFAULT_MAX_COMBINATIONS = 10000;
const MAX_PREFIX_LENGTH = 20;

const COMBINATION_OPTION_KEYS = [
  'sort',
  'maxLength',
  'allowWildcards',
  'allowBareWildcard',
  'maxCombinations',
];

const ALPHABET_OPTION_KEYS = [
  'characters',
  'prefix',
  'suffix',
  'length',
  'casing',
  'maxPatterns',
];

/**
 * Validates, normalizes and de-duplicates one side of the search.
 *
 * @param {unknown} input
 * @param {string} field
 * @param {object} [options]
 * @returns {string[]}
 */
function prepareNames(input, field, options = {}) {
  const {
    sort = false,
    maxLength,
    allowWildcards,
    allowBareWildcard,
  } = options;

  const names = assertValidNameList(input, {
    field,
    maxLength,
    allowWildcards,
    allowBareWildcard,
  });
  const uniqueNames = dedupeNames(names);

  return sort ? sortNames(uniqueNames) : uniqueNames;
}

/**
 * Generates the cartesian product of first-name and last-name inputs.
 *
 * - Inputs are validated, whitespace-normalized and de-duplicated
 *   (case-insensitively).
 * - Duplicate pairs are removed.
 * - Input order is preserved unless `options.sort` is true.
 * - Wildcard patterns are passed through untouched so the automation engine
 *   can decide how to use them. ARRT wildcard support is NOT assumed.
 * - The product is capped by `options.maxCombinations` (default 10,000) to
 *   prevent accidental memory exhaustion.
 *
 * @param {{ firstNames?: unknown, lastNames?: unknown }} input
 * @param {object} [options]
 * @param {boolean} [options.sort=false] Alphabetically sort both sides.
 * @param {number} [options.maxLength=50]
 * @param {boolean} [options.allowWildcards=true]
 * @param {boolean} [options.allowBareWildcard=false]
 * @param {number|Infinity} [options.maxCombinations=10000]
 * @returns {{ totalCombinations: number, combinations: { firstName: string, lastName: string }[] }}
 */
function generateCombinations(input, options) {
  const resolvedOptions = normalizeOptions(
    options,
    COMBINATION_OPTION_KEYS,
    'generateCombinations'
  );
  validateCombinationOptions(resolvedOptions);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(
      'generateCombinations expects an object with "firstNames" and "lastNames".'
    );
  }

  const {
    sort = false,
    maxLength,
    allowWildcards,
    allowBareWildcard,
    maxCombinations = DEFAULT_MAX_COMBINATIONS,
  } = resolvedOptions;

  const firstNames = prepareNames(input.firstNames, 'firstName', {
    sort,
    maxLength,
    allowWildcards,
    allowBareWildcard,
  });
  const lastNames = prepareNames(input.lastNames, 'lastName', {
    sort,
    maxLength,
    allowWildcards,
    allowBareWildcard,
  });

  const totalCombinations = firstNames.length * lastNames.length;

  if (totalCombinations > maxCombinations) {
    throw new NameValidationError(
      `generateCombinations would produce ${totalCombinations} combinations ` +
        `(${firstNames.length} first names x ${lastNames.length} last names), ` +
        `which exceeds maxCombinations (${maxCombinations}). ` +
        'Raise maxCombinations deliberately or reduce the input lists.',
      {
        code: 'TOO_MANY_COMBINATIONS',
        field: 'combinations',
        value: {
          firstNames: firstNames.length,
          lastNames: lastNames.length,
          maxCombinations,
        },
      }
    );
  }

  const seen = new Set();
  const combinations = [];

  for (const firstName of firstNames) {
    for (const lastName of lastNames) {
      const key = `${toNameKey(firstName)}\u0000${toNameKey(lastName)}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      combinations.push({ firstName, lastName });
    }
  }

  return {
    totalCombinations: combinations.length,
    combinations,
  };
}

/**
 * Generates alphabetical wildcard patterns such as A*, B*, ... Z*.
 *
 * Configurable through `characters` (character set), `prefix` (string or
 * array), `suffix`, `length` (multi-character patterns such as AA*) and
 * `casing`.
 *
 * @param {object} [options]
 * @param {string|string[]} [options.characters='A'..'Z']
 * @param {string|string[]} [options.prefix='']
 * @param {string} [options.suffix='*'] Empty string or only `*` characters.
 * @param {number} [options.length=1] Number of characters per pattern (1-3).
 * @param {'upper'|'lower'|'preserve'} [options.casing='upper']
 * @param {number} [options.maxPatterns=5000]
 * @returns {string[]}
 */
function generateAlphabetPatterns(options) {
  const resolvedOptions = normalizeOptions(
    options,
    ALPHABET_OPTION_KEYS,
    'generateAlphabetPatterns'
  );
  validateAlphabetOptions(resolvedOptions);

  const {
    characters = DEFAULT_ALPHABET,
    prefix = '',
    suffix = '*',
    length = 1,
    casing = 'upper',
    maxPatterns = DEFAULT_MAX_PATTERNS,
  } = resolvedOptions;

  if (
    !Number.isInteger(length) ||
    length < 1 ||
    length > MAX_ALPHABET_SEQUENCE_LENGTH
  ) {
    throw new RangeError(
      `Pattern length must be an integer between 1 and ${MAX_ALPHABET_SEQUENCE_LENGTH}, received ${String(
        length
      )}.`
    );
  }

  if (!Number.isInteger(maxPatterns) || maxPatterns < 1) {
    throw new RangeError(
      `maxPatterns must be a positive integer, received ${String(maxPatterns)}.`
    );
  }

  const characterSet = normalizeCharacterSet(characters, casing);
  const prefixes = normalizePrefixes(prefix);
  const normalizedSuffix = normalizeSuffix(suffix);
  const estimatedCount =
    characterSet.length ** length * prefixes.length;

  if (estimatedCount > maxPatterns) {
    throw new RangeError(
      `Alphabetical pattern options would generate ${estimatedCount} patterns, ` +
        `which exceeds maxPatterns (${maxPatterns}). Reduce the character set or length.`
    );
  }

  const sequences = buildCharacterSequences(characterSet, length);
  const patterns = new Set();

  for (const currentPrefix of prefixes) {
    for (const sequence of sequences) {
      patterns.add(`${currentPrefix}${sequence}${normalizedSuffix}`);
    }
  }

  return [...patterns];
}

function normalizeOptions(options, allowedKeys, operation) {
  // `undefined` means "use defaults". `null` is treated as an explicit invalid
  // value so callers get a descriptive validation error instead of a raw
  // TypeError from a property access.
  if (options === undefined) {
    return {};
  }

  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidOptionsError(
      `${operation} options must be a plain object, received ${describeValue(
        options
      )}.`,
      options
    );
  }

  const unknownKeys = Object.keys(options).filter(
    (key) => !allowedKeys.includes(key)
  );

  if (unknownKeys.length > 0) {
    throw invalidOptionsError(
      `${operation} received unknown option(s): ${unknownKeys.join(
        ', '
      )}. Allowed options: ${allowedKeys.join(', ')}.`,
      options
    );
  }

  return options;
}

function validateCombinationOptions(options) {
  assertOptionalBoolean(options.sort, 'sort');
  assertOptionalPositiveInteger(options.maxLength, 'maxLength');
  assertOptionalBoolean(options.allowWildcards, 'allowWildcards');
  assertOptionalBoolean(options.allowBareWildcard, 'allowBareWildcard');

  if (
    options.maxCombinations !== undefined &&
    options.maxCombinations !== Infinity &&
    (!Number.isInteger(options.maxCombinations) ||
      options.maxCombinations < 1)
  ) {
    throw invalidOptionsError(
      `Option "maxCombinations" must be a positive integer or Infinity, received ${describeValue(
        options.maxCombinations
      )}.`,
      options.maxCombinations
    );
  }
}

function validateAlphabetOptions(options) {
  if (
    options.characters !== undefined &&
    typeof options.characters !== 'string' &&
    !Array.isArray(options.characters)
  ) {
    throw invalidOptionsError(
      `Option "characters" must be a string or an array, received ${describeValue(
        options.characters
      )}.`,
      options.characters
    );
  }

  if (
    options.prefix !== undefined &&
    typeof options.prefix !== 'string' &&
    !Array.isArray(options.prefix)
  ) {
    throw invalidOptionsError(
      `Option "prefix" must be a string or an array, received ${describeValue(
        options.prefix
      )}.`,
      options.prefix
    );
  }

  if (
    options.suffix !== undefined &&
    options.suffix !== null &&
    typeof options.suffix !== 'string'
  ) {
    throw invalidOptionsError(
      `Option "suffix" must be a string or null, received ${describeValue(
        options.suffix
      )}.`,
      options.suffix
    );
  }

  if (options.casing !== undefined && typeof options.casing !== 'string') {
    throw invalidOptionsError(
      `Option "casing" must be a string, received ${describeValue(
        options.casing
      )}.`,
      options.casing
    );
  }

  // `length` is intentionally left to the existing 1-3 range check below so
  // its historical, more specific error message is preserved.
  assertOptionalPositiveInteger(options.maxPatterns, 'maxPatterns');
}

function assertOptionalBoolean(value, name) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw invalidOptionsError(
      `Option "${name}" must be a boolean, received ${describeValue(value)}.`,
      value
    );
  }
}

function assertOptionalPositiveInteger(value, name) {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1)
  ) {
    throw invalidOptionsError(
      `Option "${name}" must be a positive integer, received ${describeValue(
        value
      )}.`,
      value
    );
  }
}

function invalidOptionsError(message, value) {
  return new NameValidationError(message, {
    code: 'INVALID_OPTIONS',
    field: 'options',
    value,
  });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value === Infinity) return 'Infinity';
  return `type "${typeof value}"`;
}

function buildCharacterSequences(characters, length) {
  let sequences = [''];

  for (let position = 0; position < length; position += 1) {
    const nextSequences = [];
    for (const sequence of sequences) {
      for (const character of characters) {
        nextSequences.push(`${sequence}${character}`);
      }
    }
    sequences = nextSequences;
  }

  return sequences;
}

function normalizeCharacterSet(characters, casing) {
  let items;

  if (typeof characters === 'string') {
    items = [...characters.replace(/[\s,]+/g, '')];
  } else if (Array.isArray(characters)) {
    items = characters.map((character) => {
      if (typeof character !== 'string') {
        throw new TypeError('Character set entries must be strings.');
      }
      return character.trim();
    });
  } else {
    throw new TypeError(
      'characters must be provided as a string or an array of single characters.'
    );
  }

  if (items.length === 0) {
    throw new Error('Character set must contain at least one character.');
  }

  const seen = new Set();
  const result = [];

  for (const item of items) {
    if ([...item].length !== 1 || !/^[\p{L}\p{N}]$/u.test(item)) {
      throw new TypeError(
        `Character set entries must be single letters or digits, received ${JSON.stringify(
          item
        )}.`
      );
    }

    const transformed = applyCasing(item, casing);
    if ([...transformed].length !== 1) {
      throw new RangeError(
        `Character ${JSON.stringify(item)} cannot be represented as a single ` +
          `character with casing "${casing}".`
      );
    }

    if (!seen.has(transformed)) {
      seen.add(transformed);
      result.push(transformed);
    }
  }

  return result;
}

function applyCasing(character, casing) {
  switch (casing) {
    case 'upper':
    case 'uppercase':
      return character.toUpperCase();
    case 'lower':
    case 'lowercase':
      return character.toLowerCase();
    case 'preserve':
    case 'none':
      return character;
    default:
      throw new RangeError(
        `Unsupported casing "${String(
          casing
        )}". Use "upper", "lower" or "preserve".`
      );
  }
}

function normalizePrefixes(prefix) {
  const rawPrefixes = Array.isArray(prefix) ? prefix : [prefix];

  if (rawPrefixes.length === 0) {
    throw new Error('At least one prefix is required.');
  }

  const seen = new Set();
  const result = [];

  rawPrefixes.forEach((rawPrefix, index) => {
    if (typeof rawPrefix !== 'string') {
      throw new TypeError('Prefix entries must be strings.');
    }

    if (!rawPrefix.trim()) {
      if (!seen.has('')) {
        seen.add('');
        result.push('');
      }
      return;
    }

    const validation = validateName(rawPrefix, {
      field: `prefix ${index + 1}`,
      allowWildcards: false,
      maxLength: MAX_PREFIX_LENGTH,
    });

    if (!validation.valid) {
      throw new NameValidationError(
        `Invalid prefix ${JSON.stringify(rawPrefix)}: ${validation.errors
          .map((error) => error.message)
          .join(' ')}`,
        {
          code: validation.errors[0].code,
          field: 'prefix',
          value: rawPrefix,
          errors: validation.errors,
        }
      );
    }

    if (!seen.has(validation.value)) {
      seen.add(validation.value);
      result.push(validation.value);
    }
  });

  return result;
}

function normalizeSuffix(suffix) {
  if (suffix === undefined || suffix === null || suffix === '') {
    return '';
  }

  if (typeof suffix !== 'string') {
    throw new TypeError('suffix must be a string.');
  }

  if (!/^\*+$/.test(suffix.trim())) {
    throw new RangeError(
      'suffix must be empty or contain only "*" characters (e.g. "*").'
    );
  }

  return '*';
}

module.exports = {
  DEFAULT_ALPHABET,
  MAX_ALPHABET_SEQUENCE_LENGTH,
  DEFAULT_MAX_PATTERNS,
  DEFAULT_MAX_COMBINATIONS,
  generateCombinations,
  generateAlphabetPatterns,
};
