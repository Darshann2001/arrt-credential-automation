'use strict';

/**
 * Egress identity health tracking.
 *
 * This module does NOT discover, rotate or switch IP addresses. It accepts an
 * optional IP label supplied by the caller and aggregates denial signals so the
 * collection service can stop. When no label is supplied, observations are
 * grouped under "unattributed".
 */

const { invalidOption } = require('../errors');

/**
 * @param {object} [options]
 * @param {number} [options.denialThreshold=1]
 * @param {number} [options.rateLimitThreshold=2]
 * @param {number} [options.captchaThreshold=1]
 * @param {() => number} [options.now]
 */
function createIpMonitor(options = {}) {
  const denialThreshold = readPositiveInteger(
    options.denialThreshold,
    1,
    'denialThreshold'
  );
  const rateLimitThreshold = readPositiveInteger(
    options.rateLimitThreshold,
    2,
    'rateLimitThreshold'
  );
  const captchaThreshold = readPositiveInteger(
    options.captchaThreshold,
    1,
    'captchaThreshold'
  );
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const byIp = new Map();

  /**
   * @param {object} observation
   * @param {string|null} [observation.ip]
   * @param {number|null} [observation.status]
   * @param {boolean} [observation.captcha]
   * @param {string} [observation.timestamp]
   */
  function observe(observation = {}) {
    const ip =
      typeof observation.ip === 'string' && observation.ip.trim()
        ? observation.ip.trim()
        : 'unattributed';
    const timestamp = observation.timestamp || new Date(now()).toISOString();
    const status =
      observation.status === null || observation.status === undefined
        ? null
        : Number(observation.status);

    const entry = getEntry(ip);
    entry.requests += 1;
    entry.lastSeenAt = timestamp;

    if (entry.firstSeenAt === null) {
      entry.firstSeenAt = timestamp;
    }

    if (status === 403) {
      entry.http403Count += 1;
      entry.consecutiveDenials += 1;
    } else if (status === 429) {
      entry.http429Count += 1;
      entry.consecutiveDenials += 1;
    } else if (status !== null && status >= 200 && status < 400) {
      entry.consecutiveDenials = 0;
    }

    if (observation.captcha) {
      entry.captchaCount += 1;
    }

    entry.suspectedBlock =
      entry.http403Count >= denialThreshold ||
      entry.http429Count >= rateLimitThreshold ||
      entry.captchaCount >= captchaThreshold;

    return summarizeEntry(ip, entry);
  }

  function getEntry(ip) {
    if (!byIp.has(ip)) {
      byIp.set(ip, {
        ip,
        requests: 0,
        http403Count: 0,
        http429Count: 0,
        captchaCount: 0,
        consecutiveDenials: 0,
        suspectedBlock: false,
        firstSeenAt: null,
        lastSeenAt: null,
      });
    }

    return byIp.get(ip);
  }

  function getStatus(ip = 'unattributed') {
    const entry = byIp.get(typeof ip === 'string' && ip.trim() ? ip.trim() : 'unattributed');

    return entry ? summarizeEntry(entry.ip, entry) : null;
  }

  function shouldStop(ip) {
    const status = getStatus(ip);
    return Boolean(status && status.suspectedBlock);
  }

  function summary() {
    const ips = Array.from(byIp.values()).map((entry) =>
      summarizeEntry(entry.ip, entry)
    );
    const suspected = ips.filter((entry) => entry.suspectedBlock);

    return {
      ips,
      observedIdentityCount: ips.length,
      suspectedBlockCount: suspected.length,
      recommendation: suspected.length > 0 ? 'stop' : 'continue',
      rotationImplemented: false,
      ipDiscoveryImplemented: false,
    };
  }

  function reset() {
    byIp.clear();
  }

  return { observe, getStatus, shouldStop, summary, reset };
}

function summarizeEntry(ip, entry) {
  return {
    ip,
    requests: entry.requests,
    http403Count: entry.http403Count,
    http429Count: entry.http429Count,
    captchaCount: entry.captchaCount,
    consecutiveDenials: entry.consecutiveDenials,
    suspectedBlock: entry.suspectedBlock,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw invalidOption(name, 'must be a positive integer', value);
  }

  return value;
}

module.exports = {
  createIpMonitor,
};
