'use strict';

/**
 * Credential record data access.
 *
 * Only Prisma calls live here. Services own normalization/validation, so this
 * module stays a thin mapping between API filters and query clauses.
 */

const { normalizeState } = require('../../extraction/field-normalizer');
const { toNameKey } = require('../../utils/name-normalizer.util');
const { optionalText } = require('../utils/text');

/**
 * Public projection: internal `normalized*` keys are not exposed.
 */
const PUBLIC_SELECT = Object.freeze({
  id: true,
  fullName: true,
  city: true,
  state: true,
  credentialString: true,
  source: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {object} filters
 * @param {string} [filters.search]
 * @param {string} [filters.state]
 * @param {string} [filters.city]
 * @param {string} [filters.credential]
 * @returns {object}
 */
function buildRecordWhere(filters = {}) {
  const where = {};

  const search = optionalText(filters.search);
  if (search) {
    where.fullName = { contains: search, mode: 'insensitive' };
  }

  const state = optionalText(filters.state);
  if (state) {
    where.normalizedState = normalizeState(state).toUpperCase();
  }

  const city = optionalText(filters.city);
  if (city) {
    where.normalizedCity = { contains: toNameKey(city) };
  }

  const credential = optionalText(filters.credential);
  if (credential) {
    where.normalizedCredential = { contains: credential.toLowerCase() };
  }

  return where;
}

/**
 * @param {object} prisma
 */
function createRecordRepository(prisma) {
  const delegate = () => prisma.credentialRecord;

  return {
    /**
     * @param {object} params
     * @returns {Promise<{ total: number, rows: object[] }>}
     */
    async list({ search, state, city, credential, sortBy, sortOrder, skip, take }) {
      const where = buildRecordWhere({ search, state, city, credential });

      const [total, rows] = await Promise.all([
        delegate().count({ where }),
        delegate().findMany({
          where,
          orderBy: [
            { [sortBy]: sortOrder },
            { id: sortOrder },
          ],
          skip,
          take,
          select: PUBLIC_SELECT,
        }),
      ]);

      return { total, rows };
    },

    /**
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async findById(id) {
      return delegate().findUnique({ where: { id }, select: PUBLIC_SELECT });
    },

    /**
     * Inserts records, relying on the composite unique constraint for
     * duplicate prevention.
     *
     * @param {object[]} data
     * @returns {Promise<number>} Number of inserted rows.
     */
    async createMany(data) {
      if (data.length === 0) {
        return 0;
      }

      const result = await delegate().createMany({
        data,
        skipDuplicates: true,
      });

      return result.count;
    },

    async count() {
      return delegate().count();
    },

    /**
     * @param {Date} since
     */
    async countCreatedSince(since) {
      return delegate().count({ where: { createdAt: { gte: since } } });
    },

    /**
     * @returns {Promise<{ state: string, count: number }[]>}
     */
    async countByState() {
      const rows = await delegate().groupBy({
        by: ['state'],
        _count: { _all: true },
      });

      return rows
        .map((row) => ({
          state: row.state,
          count: Number(row._count?._all ?? 0),
        }))
        .sort(
          (left, right) =>
            right.count - left.count || left.state.localeCompare(right.state)
        );
    },

    /**
     * Credential type is derived in the service from the raw strings.
     *
     * @returns {Promise<string[]>}
     */
    async listCredentialStrings() {
      const rows = await delegate().findMany({
        select: { credentialString: true },
      });

      return rows.map((row) => row.credentialString);
    },
  };
}

module.exports = {
  PUBLIC_RECORD_SELECT: PUBLIC_SELECT,
  buildRecordWhere,
  createRecordRepository,
};
