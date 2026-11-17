'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_LENGTH,
  NameValidationError,
  dedupeNames,
  findMatchingNames,
  generateAlphabetPatterns,
  generateCombinations,
  hasWildcard,
  matchesWildcard,
  normalizeName,
  normalizeWhitespace,
  normalizeWildcardPattern,
  toNameList,
  validateName,
  assertValidName,
  validateNameList,
  wildcardToRegExp,
} = require('../index');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

test('single first name + single last name produces one combination', () => {
  const result = generateCombinations({
    firstNames: 'Chris',
    lastNames: 'Adams',
  });

  assert.deepEqual(result, {
    totalCombinations: 1,
    combinations: [{ firstName: 'Chris', lastName: 'Adams' }],
  });
});

test('multiple names produce a cartesian product in input order', () => {
  const result = generateCombinations({
    firstNames: ['Chris', 'Christian'],
    lastNames: ['Adams', 'Anderson'],
  });

  assert.deepEqual(result, {
    totalCombinations: 4,
    combinations: [
      { firstName: 'Chris', lastName: 'Adams' },
      { firstName: 'Chris', lastName: 'Anderson' },
      { firstName: 'Christian', lastName: 'Adams' },
      { firstName: 'Christian', lastName: 'Anderson' },
    ],
  });
  assert.equal(result.totalCombinations, result.combinations.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('duplicate names are removed case-insensitively', () => {
  const result = generateCombinations({
    firstNames: ['Chris', ' chris ', 'CHRIS'],
    lastNames: ['Adams', 'ADAMS', 'adams'],
  });

  assert.deepEqual(result, {
    totalCombinations: 1,
    combinations: [{ firstName: 'Chris', lastName: 'Adams' }],
  });
});

test('duplicate combinations cannot occur even when lists overlap', () => {
  const result = generateCombinations({
    firstNames: ['Chris', 'Christian', 'chris'],
    lastNames: ['Adams', 'Anderson'],
  });

  // "chris" is a case-insensitive duplicate of "Chris", so 2 x 2 = 4 pairs.
  assert.equal(result.totalCombinations, 4);
  const keys = result.combinations.map(
    ({ firstName, lastName }) => `${firstName}|${lastName}`.toLowerCase()
  );
  assert.equal(new Set(keys).size, keys.length);
});

test('comma and newline separated strings are accepted as input', () => {
  const result = generateCombinations({
    firstNames: 'Chris, Christian',
    lastNames: 'Adams\nAnderson',
  });

  assert.equal(result.totalCombinations, 4);
});

test('sort option orders combinations alphabetically', () => {
  const result = generateCombinations(
    {
      firstNames: ['Christian', 'Chris'],
      lastNames: ['Anderson', 'Adams'],
    },
    { sort: true }
  );

  assert.deepEqual(result.combinations, [
    { firstName: 'Chris', lastName: 'Adams' },
    { firstName: 'Chris', lastName: 'Anderson' },
    { firstName: 'Christian', lastName: 'Adams' },
    { firstName: 'Christian', lastName: 'Anderson' },
  ]);
});

test('missing or empty inputs throw meaningful validation errors', () => {
  assert.throws(
    () => generateCombinations({ lastNames: ['Adams'] }),
    (error) => {
      assert.ok(error instanceof NameValidationError);
      assert.equal(error.code, 'EMPTY_INPUT');
      assert.match(error.message, /first name/i);
      assert.match(error.message, /required/i);
      return true;
    }
  );

  assert.throws(
    () => generateCombinations({ firstNames: [], lastNames: ['Adams'] }),
    /first name list.*required/i
  );

  assert.throws(
    () =>
      generateCombinations({ firstNames: ['Chris'], lastNames: '   ' }),
    /last name list.*required/i
  );
});

test('non-object generator input is rejected', () => {
  assert.throws(
    () => generateCombinations(null),
    /expects an object with "firstNames" and "lastNames"/i
  );
  assert.throws(
    () => generateCombinations(['Chris']),
    /expects an object/i
  );
});

test('wildcard patterns are preserved in generated combinations', () => {
  const result = generateCombinations({
    firstNames: ['A*', 'B*', 'Chris*'],
    lastNames: ['Adams*'],
  });

  assert.deepEqual(result.combinations, [
    { firstName: 'A*', lastName: 'Adams*' },
    { firstName: 'B*', lastName: 'Adams*' },
    { firstName: 'Chris*', lastName: 'Adams*' },
  ]);
});

test('wildcards can be disabled for literal-only searches', () => {
  assert.throws(
    () =>
      generateCombinations(
        { firstNames: ['A*'], lastNames: ['Adams'] },
        { allowWildcards: false }
      ),
    (error) => {
      assert.ok(error instanceof NameValidationError);
      assert.equal(error.code, 'WILDCARD_NOT_ALLOWED');
      return true;
    }
  );
});

test('names are whitespace-normalized and casing is preserved', () => {
  const result = generateCombinations({
    firstNames: ['  Chris\t'],
    lastNames: ["  O' Brien  "],
  });

  assert.deepEqual(result.combinations, [
    { firstName: 'Chris', lastName: "O'Brien" },
  ]);
  assert.equal(normalizeWhitespace('  Chris \t\n Adams  '), 'Chris Adams');
  assert.equal(normalizeName('  Smith  -  Jones '), 'Smith-Jones');
  assert.equal(normalizeName('O\u2019 Brien'), "O'Brien");
  assert.deepEqual(toNameList('Chris, Adam;John\nBob'), [
    'Chris',
    'Adam',
    'John',
    'Bob',
  ]);
  assert.deepEqual(dedupeNames(['Chris', ' chris ', 'CHRIS']), ['Chris']);
});

test('invalid characters are rejected with descriptive errors', () => {
  for (const invalid of ['Chris123', 'Ada$', 'John_Doe', 'Chris@home', '<script>']) {
    const result = validateName(invalid);
    assert.equal(result.valid, false, `${invalid} should be invalid`);
    assert.equal(result.errors[0].code, 'INVALID_CHARACTERS');

    assert.throws(
      () => assertValidName(invalid, { field: 'firstName' }),
      (error) => {
        assert.ok(error instanceof NameValidationError);
        assert.equal(error.code, 'INVALID_CHARACTERS');
        assert.match(error.message, /first name/i);
        assert.match(error.message, /invalid character/i);
        return true;
      }
    );
  }
});

test('valid special characters commonly found in names are allowed', () => {
  for (const valid of ["O'Brien", 'Smith-Jones', 'St. John', 'José', 'van der Berg']) {
    assert.equal(validateName(valid).valid, true, `${valid} should be valid`);
  }
});

test('empty, non-string and over-long values fail validation', () => {
  assert.equal(validateName('   ').errors[0].code, 'EMPTY_INPUT');
  assert.equal(validateName(null).errors[0].code, 'INVALID_TYPE');
  assert.equal(
    validateName('A'.repeat(DEFAULT_MAX_LENGTH + 1)).errors[0].code,
    'TOO_LONG'
  );

  const customLimit = validateName('Christian', { maxLength: 5 });
  assert.equal(customLimit.valid, false);
  assert.equal(customLimit.errors[0].code, 'TOO_LONG');
  assert.match(customLimit.errors[0].message, /at most 5 characters/);
});

test('_list validation reports the failing entry index', () => {
  const result = validateNameList(['Chris', 'Adam123', 'John']);

  assert.equal(result.valid, false);
  assert.equal(result.names.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 1);
  assert.match(result.errors[0].message, /Entry 2/);
});

test('wildcard pattern normalization and validation', () => {
  assert.equal(normalizeWildcardPattern('  Chris**  '), 'Chris*');
  assert.equal(hasWildcard('A*'), true);
  assert.equal(hasWildcard('Chris'), false);
  assert.equal(validateName('*').errors[0].code, 'BARE_WILDCARD');
  assert.equal(validateName('*', { allowBareWildcard: true }).valid, true);
  assert.equal(validateName('A*').valid, true);
  assert.equal(validateName('A*', { allowWildcards: false }).valid, false);
  assert.throws(() => normalizeWildcardPattern('   '), /must not be empty/);
});

test('wildcard matching is case-insensitive and anchor-safe', () => {
  assert.equal(matchesWildcard('Chris', 'chris*'), true);
  assert.equal(matchesWildcard('CHRISTIAN', 'Chris*'), true);
  assert.equal(matchesWildcard('Christopher', 'Chris*'), true);
  assert.equal(matchesWildcard('Adam', 'A*'), true);
  assert.equal(matchesWildcard('Bob', 'A*'), false);
  assert.equal(matchesWildcard('Adam', 'Ada'), false);
  assert.equal(matchesWildcard('Adam', 'Ada', { prefix: true }), true);

  const regex = wildcardToRegExp('A*');
  assert.equal(regex.test('anderson'), true);
  assert.equal(regex.test('Smith'), false);
});

test('regex metacharacters in patterns are escaped literally', () => {
  assert.equal(matchesWildcard('A.B', 'A.B*'), true);
  assert.equal(matchesWildcard('AXB', 'A.B*'), false);
  assert.equal(matchesWildcard('A+Bees', 'A+B*'), true);
  assert.equal(matchesWildcard('AAABees', 'A+B*'), false);
  assert.equal(matchesWildcard('(test)', '(test)*'), true);
});

test('findMatchingNames filters a list using case-insensitive wildcards', () => {
  const names = ['Chris', 'Christian', 'Adam', 'Bob', 'chris'];

  assert.deepEqual(findMatchingNames(names, ['Chris*', 'A*']), [
    'Chris',
    'Christian',
    'Adam',
  ]);
  assert.deepEqual(findMatchingNames(names, ['Z*']), []);
});

test('default alphabet patterns are A* through Z*', () => {
  const patterns = generateAlphabetPatterns();

  assert.equal(patterns.length, 26);
  assert.deepEqual(patterns, ALPHABET.map((letter) => `${letter}*`));
  assert.equal(patterns[0], 'A*');
  assert.equal(patterns.at(-1), 'Z*');
});

test('alphabet patterns support custom character sets and prefixes', () => {
  assert.deepEqual(generateAlphabetPatterns({ characters: 'A,B,C' }), [
    'A*',
    'B*',
    'C*',
  ]);
  assert.deepEqual(
    generateAlphabetPatterns({ characters: 'abc', casing: 'upper' }),
    ['A*', 'B*', 'C*']
  );
  assert.deepEqual(
    generateAlphabetPatterns({ characters: ['a', 'b'], casing: 'lower' }),
    ['a*', 'b*']
  );
  assert.deepEqual(
    generateAlphabetPatterns({ characters: 'AB', prefix: 'Mc' }),
    ['McA*', 'McB*']
  );
  assert.deepEqual(
    generateAlphabetPatterns({ characters: 'AB', prefix: ['', 'X'] }),
    ['A*', 'B*', 'XA*', 'XB*']
  );
  assert.deepEqual(generateAlphabetPatterns({ characters: 'AB', suffix: '' }), [
    'A',
    'B',
  ]);
  assert.deepEqual(
    generateAlphabetPatterns({ characters: 'AB', length: 2 }),
    ['AA*', 'AB*', 'BA*', 'BB*']
  );
  assert.deepEqual(
    generateAlphabetPatterns({ characters: 'AB', prefix: 'X', suffix: '**' }),
    ['XA*', 'XB*']
  );
});

test('alphabet pattern options are validated', () => {
  assert.throws(
    () => generateAlphabetPatterns({ characters: '' }),
    /at least one character/i
  );
  assert.throws(
    () => generateAlphabetPatterns({ characters: ['AB'] }),
    /single letters or digits/i
  );
  assert.throws(
    () => generateAlphabetPatterns({ characters: 'AB', suffix: 'son*' }),
    /suffix must be empty/i
  );
  assert.throws(
    () => generateAlphabetPatterns({ characters: 'AB', prefix: 'X*' }),
    /Invalid prefix/i
  );
  assert.throws(
    () => generateAlphabetPatterns({ characters: 'AB', length: 0 }),
    /between 1 and 3/i
  );
  assert.throws(
    () =>
      generateAlphabetPatterns({
        characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        length: 3,
        maxPatterns: 100,
      }),
    /exceeds maxPatterns/i
  );
  assert.throws(
    () => generateAlphabetPatterns({ casing: 'title' }),
    /Unsupported casing/i
  );
});
