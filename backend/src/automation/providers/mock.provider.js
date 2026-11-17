'use strict';

/**
 * Deterministic fixture-backed provider.
 *
 * The mock provider never touches the network. It exists so the collection,
 * monitoring, retry and stop-condition logic can be exercised without ARRT
 * access. All content is synthetic.
 */

const path = require('node:path');

const { loadFixture } = require('../../extraction/html-loader');
const { AUTOMATION_CODES, AutomationError, invalidOption } = require('../errors');
const { PROVIDER_MODES } = require('./data-source.provider');

const FIXTURE_DIR = path.join(
  __dirname,
  '..',
  '..',
  'extraction',
  'fixtures'
);

const DEFAULT_FIXTURES = Object.freeze([
  path.join(FIXTURE_DIR, 'normal.html'),
  path.join(FIXTURE_DIR, 'page-1.html'),
  path.join(FIXTURE_DIR, 'page-2.html'),
]);

const EMPTY_HTML =
  '<!doctype html><html><body><p>Mock provider error response.</p></body></html>';

/**
 * @param {object} [options]
 * @param {string[]} [options.fixtures] Fixture paths cycled by search index.
 * @param {Array<Array<object>|object>} [options.script] Per-search attempt overrides.
 * @param {number} [options.latencyMs=0]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.wait]
 */
function createMockProvider(options = {}) {
  const fixtures = normalizeFixtures(options.fixtures || DEFAULT_FIXTURES);
  const script = options.script || [];
  const latencyMs = readNonNegativeInteger(options.latencyMs, 0, 'latencyMs');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const wait =
    typeof options.wait === 'function'
      ? options.wait
      : async () => undefined;

  const calls = [];
  let sequence = 0;

  async function fetchPage(search = {}, context = {}) {
    const searchIndex = Number.isInteger(context.searchIndex)
      ? context.searchIndex
      : sequence;
    const attempt = Number.isInteger(context.attempt) ? context.attempt : 1;
    const outcome = resolveOutcome(script, searchIndex, attempt);
    const effectiveLatency = outcome.latencyMs ?? latencyMs;

    if (effectiveLatency > 0) {
      await wait(effectiveLatency);
    }

    const call = {
      searchIndex,
      attempt,
      firstName: search.firstName ?? null,
      lastName: search.lastName ?? null,
      timestamp: new Date(now()).toISOString(),
      outcome: outcome.kind,
    };

    calls.push(call);
    sequence += 1;

    if (outcome.kind === 'error') {
      const error = outcome.error;

      if (error instanceof Error) {
        throw error;
      }

      throw new AutomationError(
        `Mock provider failure (${outcome.code || 'MOCK_ERROR'}).`,
        {
          code: outcome.code || AUTOMATION_CODES.PROVIDER_ERROR,
          retryable: outcome.retryable !== false,
          url: `mock://search/${searchIndex + 1}`,
          details: { searchIndex, attempt },
        }
      );
    }

    if (outcome.kind === 'timeout') {
      const error = new Error('Mock request timed out.');
      error.name = 'TimeoutError';
      error.code = 'ETIMEDOUT';
      error.retryable = true;
      throw error;
    }

    const fixturePath = outcome.fixture
      ? resolveFixture(outcome.fixture, fixtures)
      : fixtures[searchIndex % fixtures.length];
    const loaded = loadFixture(fixturePath);
    const status = outcome.status ?? 200;
    const captcha = outcome.captcha || null;

    return {
      html: outcome.html || loaded.html,
      status,
      fixture: loaded.fixture,
      url: `mock://search/${searchIndex + 1}/attempt/${attempt}`,
      sourceUrl: `mock://search/${searchIndex + 1}`,
      pageNumber: searchIndex + 1,
      captcha,
      headers: outcome.headers || {},
    };
  }

  function snapshot() {
    return {
      id: 'mock-fixtures',
      mode: PROVIDER_MODES.MOCK,
      requiresBrowser: false,
      fixtures: fixtures.map((fixture) => path.basename(fixture)),
      calls: calls.length,
      sequence,
    };
  }

  return {
    id: 'mock-fixtures',
    mode: PROVIDER_MODES.MOCK,
    requiresBrowser: false,
    description:
      'Deterministic synthetic fixture provider. No network access.',
    fetchPage,
    snapshot,
    getCalls: () => calls.slice(),
  };
}

function resolveOutcome(script, searchIndex, attempt) {
  const entry = script[searchIndex];

  if (!entry) {
    return { kind: 'page' };
  }

  const candidate = Array.isArray(entry)
    ? entry[Math.min(attempt - 1, entry.length - 1)]
    : entry;

  if (!candidate) {
    return { kind: 'page' };
  }

  if (candidate.error) {
    return { ...candidate, kind: 'error' };
  }

  if (candidate.timeout) {
    return { ...candidate, kind: 'timeout' };
  }

  if (candidate.status === 403 || candidate.status === 429) {
    return { ...candidate, kind: 'page' };
  }

  return { ...candidate, kind: 'page' };
}

function normalizeFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw invalidOption(
      'fixtures',
      'must be a non-empty array of fixture paths',
      fixtures
    );
  }

  return fixtures.map((fixture) => {
    if (typeof fixture !== 'string' || !fixture.trim()) {
      throw invalidOption(
        'fixtures',
        'must contain non-empty fixture paths',
        fixture
      );
    }

    const trimmed = fixture.trim();

    if (path.isAbsolute(trimmed) || trimmed.startsWith('.')) {
      return path.resolve(trimmed);
    }

    return path.join(FIXTURE_DIR, trimmed);
  });
}

function resolveFixture(fixture, fallbacks) {
  if (typeof fixture !== 'string' || !fixture.trim()) {
    return fallbacks[0];
  }

  if (path.isAbsolute(fixture)) {
    return fixture;
  }

  return path.join(FIXTURE_DIR, fixture);
}

function readNonNegativeInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw invalidOption(name, 'must be a non-negative integer', value);
  }

  return value;
}

module.exports = {
  DEFAULT_FIXTURES,
  EMPTY_HTML,
  createMockProvider,
};
