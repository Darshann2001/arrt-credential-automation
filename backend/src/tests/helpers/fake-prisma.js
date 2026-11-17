'use strict';

/**
 * In-memory Prisma stand-in for HTTP/service tests.
 *
 * It implements only the subset of the Prisma client used by this project, plus
 * the same unique-constraint (`P2002`) and missing-row (`P2025`) error codes so
 * error mapping is exercised realistically. Tests never touch PostgreSQL and
 * never contact ARRT.
 */

const crypto = require('node:crypto');

class PrismaLikeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
  }
}

const CREDENTIAL_DEFAULTS = Object.freeze({
  source: 'ARRT',
});

function createFakePrisma(seed = {}) {
  const state = {
    records: [],
    jobs: [],
    logs: [],
  };

  if (Array.isArray(seed.records)) {
    state.records = seed.records.map(buildStoredRecord);
  }

  const failures = new Map();

  const fail = (model, method, error) => {
    failures.set(`${model}.${method}`, error);
  };

  const maybeFail = (model, method) => {
    const error = failures.get(`${model}.${method}`);
    if (!error) {
      return;
    }
    throw typeof error === 'function' ? error() : error;
  };

  function buildStoredRecord(input) {
    const now = input.createdAt ? new Date(input.createdAt) : new Date();

    return {
      id: input.id || crypto.randomUUID(),
      fullName: input.fullName,
      city: input.city,
      state: input.state,
      credentialString: input.credentialString,
      normalizedName: input.normalizedName ?? String(input.fullName || '').toLowerCase(),
      normalizedCity: input.normalizedCity ?? String(input.city || '').toLowerCase(),
      normalizedState: input.normalizedState ?? String(input.state || '').toUpperCase(),
      normalizedCredential:
        input.normalizedCredential ?? String(input.credentialString || '').toLowerCase(),
      source: input.source ?? CREDENTIAL_DEFAULTS.source,
      createdAt: now,
      updatedAt: input.updatedAt ? new Date(input.updatedAt) : now,
    };
  }

  const recordIdentity = (record) =>
    [
      record.normalizedName,
      record.normalizedCity,
      record.normalizedState,
      record.normalizedCredential,
    ].join('\u0000');

  const prisma = {
    credentialRecord: {
      async createMany({ data = [], skipDuplicates = false }) {
        maybeFail('credentialRecord', 'createMany');

        const existing = new Set(state.records.map(recordIdentity));
        let count = 0;

        for (const item of data) {
          const record = buildStoredRecord(item);
          const key = recordIdentity(record);

          if (existing.has(key)) {
            if (skipDuplicates) {
              continue;
            }

            throw new PrismaLikeError(
              'P2002',
              'Unique constraint failed on credential_records_identity_key'
            );
          }

          existing.add(key);
          state.records.push(record);
          count += 1;
        }

        return { count };
      },

      async findMany(args = {}) {
        maybeFail('credentialRecord', 'findMany');
        return findMany(state.records, args, state);
      },

      async findUnique({ where, select }) {
        maybeFail('credentialRecord', 'findUnique');
        const record = state.records.find((candidate) => candidate.id === where.id);
        return record ? project(record, select, state) : null;
      },

      async count({ where } = {}) {
        maybeFail('credentialRecord', 'count');
        return state.records.filter((record) => matchesWhere(record, where)).length;
      },

      async groupBy({ by, _count }) {
        maybeFail('credentialRecord', 'groupBy');

        const groups = new Map();

        for (const record of state.records) {
          const key = by.map((field) => String(record[field])).join('\u0000');
          const current = groups.get(key);

          if (current) {
            current.count += 1;
          } else {
            groups.set(key, {
              values: Object.fromEntries(by.map((field) => [field, record[field]])),
              count: 1,
            });
          }
        }

        return [...groups.values()].map(({ values, count }) => ({
          ...values,
          _count: {
            ...(_count && _count._all ? { _all: count } : {}),
            ...Object.fromEntries(
              by
                .filter((field) => _count && _count[field])
                .map((field) => [field, count])
            ),
          },
        }));
      },
    },

    collectionJob: {
      async create({ data = {}, select }) {
        maybeFail('collectionJob', 'create');

        const now = new Date();
        const job = {
          id: data.id || crypto.randomUUID(),
          status: data.status ?? 'PENDING',
          source: data.source ?? CREDENTIAL_DEFAULTS.source,
          requestedTarget: data.requestedTarget ?? 0,
          recordsFound: data.recordsFound ?? 0,
          recordsInserted: data.recordsInserted ?? 0,
          recordsSkipped: data.recordsSkipped ?? 0,
          recordsRejected: data.recordsRejected ?? 0,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null,
          errorMessage: data.errorMessage ?? null,
          createdAt: now,
          updatedAt: now,
        };

        state.jobs.push(job);
        return project(job, select, state);
      },

      async findUnique({ where, select }) {
        maybeFail('collectionJob', 'findUnique');
        const job = state.jobs.find((candidate) => candidate.id === where.id);
        return job ? project(job, select, state) : null;
      },

      async findMany(args = {}) {
        maybeFail('collectionJob', 'findMany');
        return findMany(state.jobs, args, state);
      },

      async count({ where } = {}) {
        maybeFail('collectionJob', 'count');
        return state.jobs.filter((job) => matchesWhere(job, where)).length;
      },

      async update({ where, data = {}, select }) {
        maybeFail('collectionJob', 'update');

        const job = state.jobs.find((candidate) => candidate.id === where.id);

        if (!job) {
          throw new PrismaLikeError('P2025', 'Record to update not found.');
        }

        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            job[key] = Number(job[key] || 0) + Number(value.increment);
          } else if (value && typeof value === 'object' && 'set' in value) {
            job[key] = value.set;
          } else {
            job[key] = value;
          }
        }

        job.updatedAt = new Date();
        return project(job, select, state);
      },
    },

    collectionJobLog: {
      async create({ data = {}, select }) {
        maybeFail('collectionJobLog', 'create');

        if (!state.jobs.some((job) => job.id === data.jobId)) {
          throw new PrismaLikeError('P2003', 'Foreign key constraint failed');
        }

        const log = {
          id: data.id || crypto.randomUUID(),
          jobId: data.jobId,
          level: data.level ?? 'INFO',
          message: data.message,
          createdAt: new Date(),
        };

        state.logs.push(log);
        return project(log, select, state);
      },

      async findMany(args = {}) {
        maybeFail('collectionJobLog', 'findMany');
        return findMany(state.logs, args, state);
      },
    },

    async $transaction(fn) {
      return fn(prisma);
    },

    async $queryRaw() {
      maybeFail('$queryRaw', '$queryRaw');
      return [{ '?column?': 1 }];
    },

    async $disconnect() {
      // no-op
    },

    // Test hooks (not part of the Prisma API).
    __state: state,
    __fail: fail,
    __clearFailures() {
      failures.clear();
    },
    __reset() {
      state.records.length = 0;
      state.jobs.length = 0;
      state.logs.length = 0;
      failures.clear();
    },
  };

  return prisma;
}

function findMany(collection, { where, orderBy, skip = 0, take, select } = {}) {
  const filtered = collection.filter((item) => matchesWhere(item, where));
  const sorted = orderBy ? sortBy(filtered, orderBy) : filtered;
  const sliced =
    typeof take === 'number'
      ? sorted.slice(skip, skip + take)
      : sorted.slice(skip);

  return sliced.map((item) => project(item, select, null));
}

function sortBy(items, orderBy) {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];

  return [...items].sort((left, right) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const result = compareValues(left[field], right[field]);
        if (result !== 0) {
          return String(direction).toLowerCase() === 'desc' ? -result : result;
        }
      }
    }
    return 0;
  });
}

function compareValues(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (leftValue === rightValue) {
    return 0;
  }

  if (leftValue === null || leftValue === undefined) {
    return -1;
  }

  if (rightValue === null || rightValue === undefined) {
    return 1;
  }

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue));
}

function project(record, select, state) {
  if (!select) {
    return clone(record);
  }

  const output = {};

  for (const [key, include] of Object.entries(select)) {
    if (!include) {
      continue;
    }

    if (key === 'logs' && state) {
      const logs = state.logs.filter((log) => log.jobId === record.id);
      const ordered = include.orderBy ? sortBy(logs, include.orderBy) : logs;
      output.logs = ordered.map((log) => project(log, include.select, state));
      continue;
    }

    if (key in record) {
      output[key] = clone(record[key]);
    }
  }

  return output;
}

function matchesWhere(record, where) {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return condition.some((sub) => matchesWhere(record, sub));
    }

    if (key === 'AND') {
      return condition.every((sub) => matchesWhere(record, sub));
    }

    if (key === 'NOT') {
      return !matchesWhere(record, condition);
    }

    return matchesCondition(record[key], condition);
  });
}

function matchesCondition(value, condition) {
  if (condition instanceof Date) {
    return value instanceof Date && value.getTime() === condition.getTime();
  }

  if (condition === null || typeof condition !== 'object') {
    return value === condition;
  }

  if ('contains' in condition) {
    const haystack = typeof value === 'string' ? value : '';
    const needle = String(condition.contains);
    const caseSensitive = condition.mode !== 'insensitive';
    return caseSensitive
      ? haystack.includes(needle)
      : haystack.toLowerCase().includes(needle.toLowerCase());
  }

  if ('gte' in condition) {
    return new Date(value).getTime() >= new Date(condition.gte).getTime();
  }

  if ('gt' in condition) {
    return new Date(value).getTime() > new Date(condition.gt).getTime();
  }

  if ('lte' in condition) {
    return new Date(value).getTime() <= new Date(condition.lte).getTime();
  }

  if ('lt' in condition) {
    return new Date(value).getTime() < new Date(condition.lt).getTime();
  }

  if ('equals' in condition) {
    return matchesCondition(value, condition.equals);
  }

  if ('in' in condition) {
    return condition.in.some((candidate) => matchesCondition(value, candidate));
  }

  if ('not' in condition) {
    return !matchesCondition(value, condition.not);
  }

  return false;
}

function clone(value) {
  return value instanceof Date ? new Date(value) : structuredClone(value);
}

module.exports = {
  PrismaLikeError,
  createFakePrisma,
  // Exported for focused unit tests.
  matchesWhere,
  sortBy,
};
