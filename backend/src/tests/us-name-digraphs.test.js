'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPlausibleUsNameDigraph,
  listUsNameDigraphs,
  listUsFirstNameDigraphs,
  listUsLastNameDigraphs,
} = require('../utils/us-name-digraphs.util');

test('US digraph filter rejects junk and keeps real name fragments', () => {
  assert.equal(isPlausibleUsNameDigraph('xz'), false);
  assert.equal(isPlausibleUsNameDigraph('xx'), false);
  assert.equal(isPlausibleUsNameDigraph('ch'), true);
  assert.equal(isPlausibleUsNameDigraph('ad'), true);
  assert.equal(isPlausibleUsNameDigraph('qu'), true);
  assert.equal(isPlausibleUsNameDigraph('mc'), true);
});

test('US digraph filter rejects non-two-letter and wildcard input', () => {
  for (const value of ['', 'a', 'abc', 'A*', '*', null, undefined, 12]) {
    assert.equal(isPlausibleUsNameDigraph(value), false);
  }
});

test('digraph list is ranked, deduplicated and wildcard-free', () => {
  const digraphs = listUsNameDigraphs();

  assert.ok(digraphs.length > 0);
  assert.equal(new Set(digraphs).size, digraphs.length);
  assert.equal(digraphs[0], 'ch');
  assert.ok(digraphs.indexOf('ad') < 5);

  for (const digraph of digraphs) {
    assert.match(digraph, /^[a-z]{2}$/);
    assert.ok(!digraph.includes('*'));
  }

  assert.equal(listUsFirstNameDigraphs().length, digraphs.length);
  assert.equal(listUsLastNameDigraphs().length, digraphs.length);
});
