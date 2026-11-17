'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const {
  DEFAULT_MAX_COMBINATIONS,
  MAX_PATTERN_LENGTH,
  NameValidationError,
  countWildcards,
  findMatchingNames,
  generateAlphabetPatterns,
  generateCombinations,
  matchesWildcard,
  validateName,
  wildcardToRegExp,
} = require('../index');

function assertOptionError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof NameValidationError);
    assert.equal(error.code, 'INVALID_OPTIONS');
    assert.match(error.message, pattern);
    return true;
  });
}

test('bounded wildcard matcher handles pathological patterns quickly', () => {
  const pattern = `${'a*'.repeat(12)}b`;
  const value = 'a'.repeat(30);

  const started = performance.now();
  const result = matchesWildcard(value, pattern);
  const elapsed = performance.now() - started;

  assert.equal(result, false);
  assert.ok(
    elapsed < 500,
    `expected bounded matching under 500ms, measured ${elapsed.toFixed(2)}ms`
  );
});

test('bounded wildcard matcher still matches valid complex patterns', () => {
  const pattern = `${'a*'.repeat(12)}b`;

  assert.equal(matchesWildcard(`${'a'.repeat(12)}b`, pattern), true);
  assert.equal(matchesWildcard(`b${'a'.repeat(5)}c`, 'b*a*c'), true);
  assert.equal(matchesWildcard('bcccc', 'b*a*c'), false);
});

test('wildcardToRegExp rejects patterns above the safe regex limit', () => {
  assert.throws(
    () => wildcardToRegExp('a*a*a*a*a*b'),
    /at most 4.*matchesWildcard/i
  );

  // Four wildcards remain supported for backwards compatibility.
  assert.doesNotThrow(() => wildcardToRegExp('a*a*a*a*b'));
});

test('wildcard count helper normalizes repeated wildcards', () => {
  assert.equal(countWildcards('A**B*'), 2);
  assert.equal(countWildcards('Chris'), 0);
  assert.throws(
    () => countWildcards('A'.repeat(MAX_PATTERN_LENGTH + 1)),
    /at most 100 characters/i
  );
});

test('names with too many wildcards are rejected during validation', () => {
  const result = validateName(`${'a*'.repeat(9)}`);

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'WILDCARD_TOO_COMPLEX');
  assert.match(result.errors[0].message, /at most 8 wildcards/i);
});

test('findMatchingNames uses the bounded matcher for complex patterns', () => {
  const names = ['aaaaaaaaaaaaab', 'aaaaaaaaaaaaac', 'Bob'];
  const started = performance.now();
  const matches = findMatchingNames(names, [`${'a*'.repeat(12)}b`]);
  const elapsed = performance.now() - started;

  assert.deepEqual(matches, ['aaaaaaaaaaaaab']);
  assert.ok(elapsed < 500, `expected under 500ms, measured ${elapsed.toFixed(2)}ms`);
});

test('generateCombinations enforces maxCombinations', () => {
  const input = {
    firstNames: ['A', 'B', 'C', 'D', 'E'],
    lastNames: ['One', 'Two', 'Three', 'Four', 'Five'],
  };

  assert.throws(
    () => generateCombinations(input, { maxCombinations: 10 }),
    (error) => {
      assert.ok(error instanceof NameValidationError);
      assert.equal(error.code, 'TOO_MANY_COMBINATIONS');
      assert.match(error.message, /25 combinations/);
      assert.match(error.message, /maxCombinations \(10\)/);
      return true;
    }
  );

  const allowed = generateCombinations(input, { maxCombinations: 25 });
  assert.equal(allowed.totalCombinations, 25);

  const unlimited = generateCombinations(input, { maxCombinations: Infinity });
  assert.equal(unlimited.totalCombinations, 25);
});

test('maxCombinations defaults to a documented cap', () => {
  assert.equal(DEFAULT_MAX_COMBINATIONS, 10000);

  const alphaName = (value) => {
    let result = '';
    let number = value + 1;
    while (number > 0) {
      const remainder = (number - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      number = Math.floor((number - 1) / 26);
    }
    return result;
  };
  const firstNames = Array.from({ length: 151 }, (_, i) => `First${alphaName(i)}`);
  const lastNames = Array.from({ length: 100 }, (_, i) => `Last${alphaName(i)}`);

  assert.throws(
    () =>
      generateCombinations({
        firstNames,
        lastNames,
      }),
    (error) => {
      assert.equal(error.code, 'TOO_MANY_COMBINATIONS');
      assert.match(error.message, /15100 combinations/);
      return true;
    }
  );
});

test('invalid maxCombinations values are rejected deliberately', () => {
  for (const value of [0, -1, 1.5, '10', null]) {
    assertOptionError(
      () =>
        generateCombinations(
          { firstNames: 'A', lastNames: 'B' },
          { maxCombinations: value }
        ),
      /maxCombinations.*positive integer or Infinity/i
    );
  }
});

test('undefined options use defaults while null is rejected deliberately', () => {
  const combinations = generateCombinations({
    firstNames: ['Chris'],
    lastNames: ['Adams'],
  });
  assert.equal(combinations.totalCombinations, 1);
  assert.equal(generateAlphabetPatterns().length, 26);

  assertOptionError(
    () =>
      generateCombinations(
        { firstNames: ['Chris'], lastNames: ['Adams'] },
        null
      ),
    /options must be a plain object, received null/i
  );
  assertOptionError(
    () => generateAlphabetPatterns(null),
    /options must be a plain object, received null/i
  );
});

test('invalid options produce deliberate validation errors', () => {
  for (const options of [[], 'options', 42, true]) {
    assertOptionError(
      () => generateCombinations({ firstNames: 'A', lastNames: 'B' }, options),
      /options must be a plain object/i
    );
  }

  assertOptionError(
    () =>
      generateCombinations(
        { firstNames: 'A', lastNames: 'B' },
        { unknownOption: true }
      ),
    /unknown option\(s\): unknownOption/i
  );

  assertOptionError(
    () =>
      generateCombinations(
        { firstNames: 'A', lastNames: 'B' },
        { sort: 'yes' }
      ),
    /Option "sort" must be a boolean/i
  );

  assertOptionError(
    () =>
      generateCombinations(
        { firstNames: 'A', lastNames: 'B' },
        { maxLength: 0 }
      ),
    /Option "maxLength" must be a positive integer/i
  );

  assertOptionError(
    () => generateAlphabetPatterns({ characters: 123 }),
    /Option "characters" must be a string or an array/i
  );

  assert.throws(
    () => generateAlphabetPatterns([]),
    (error) => {
      assert.equal(error.code, 'INVALID_OPTIONS');
      return true;
    }
  );
});

test('overlapping validation errors are reduced to a primary cause', () => {
  const disallowedWildcard = validateName('*', { allowWildcards: false });
  assert.equal(disallowedWildcard.errors.length, 1);
  assert.equal(disallowedWildcard.errors[0].code, 'WILDCARD_NOT_ALLOWED');

  const bareWildcard = validateName('*');
  assert.equal(bareWildcard.errors.length, 1);
  assert.equal(bareWildcard.errors[0].code, 'BARE_WILDCARD');

  const invalidCharacters = validateName('123');
  assert.deepEqual(
    invalidCharacters.errors.map((error) => error.code),
    ['INVALID_CHARACTERS']
  );

  const punctuationOnly = validateName('...');
  assert.deepEqual(
    punctuationOnly.errors.map((error) => error.code),
    ['REQUIRES_LETTER']
  );

  const mixed = validateName('Chris123*', { allowWildcards: false });
  assert.deepEqual(
    mixed.errors.map((error) => error.code),
    ['WILDCARD_NOT_ALLOWED', 'INVALID_CHARACTERS']
  );
});
