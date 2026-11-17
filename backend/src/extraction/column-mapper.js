'use strict';

/**
 * Header-based column mapping.
 *
 * Result tables are mapped by header label, never by fixed column position.
 * Add aliases here when an authorized sample reveals another label; do not
 * guess ARRT-specific labels beyond the documented set.
 */

const { normalizeWhitespace } = require('../utils/name-normalizer.util');

const DEFAULT_REQUIRED_FIELDS = [
  'fullName',
  'city',
  'state',
  'credentialString',
];

const FIELD_ALIASES = Object.freeze({
  fullName: [
    'name',
    'full name',
    'credential holder',
    'holder name',
    'individual name',
    'licensee name',
  ],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'st', 'state province', 'province', 'state or province'],
  credentialString: [
    'credential',
    'credentials',
    'credential s',
    'credential string',
    'credential number',
    'credential id',
    'license',
    'license number',
    'registration number',
  ],
  recordId: [
    'record id',
    'record identifier',
    'source id',
    'record number',
    'record no',
    'id',
  ],
});

/**
 * Normalizes a header label for alias comparison.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeHeaderLabel(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Header labels must be strings.');
  }

  return normalizeWhitespace(
    value.replace(/[\u200B-\u200D\uFEFF]/g, '')
  )
    .toLowerCase()
    .replace(/[:*]+$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Maps header labels to field column indexes.
 *
 * @param {string[]} headerLabels
 * @param {object} [options]
 * @param {object} [options.aliases]
 * @param {string[]} [options.requiredFields]
 * @returns {{
 *   columns: Record<string, number>,
 *   labels: Record<string, string>,
 *   missing: string[],
 *   duplicateHeaders: { field: string, firstIndex: number, duplicateIndex: number, label: string }[]
 * }}
 */
function mapHeaders(headerLabels, options = {}) {
  if (!Array.isArray(headerLabels)) {
    throw new TypeError('Header labels must be provided as an array.');
  }

  const aliases = options.aliases || FIELD_ALIASES;
  const requiredFields = options.requiredFields || DEFAULT_REQUIRED_FIELDS;
  const aliasLookup = buildAliasLookup(aliases);

  const columns = {};
  const labels = {};
  const duplicateHeaders = [];

  headerLabels.forEach((header, index) => {
    if (typeof header !== 'string') {
      return;
    }

    const normalized = normalizeHeaderLabel(header);
    if (!normalized) {
      return;
    }

    const field = aliasLookup.get(normalized);
    if (!field) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(columns, field)) {
      duplicateHeaders.push({
        field,
        firstIndex: columns[field],
        duplicateIndex: index,
        label: header,
      });
      return;
    }

    columns[field] = index;
    labels[field] = normalizeWhitespace(header);
  });

  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(columns, field)
  );

  return { columns, labels, missing, duplicateHeaders };
}

function buildAliasLookup(aliases) {
  const lookup = new Map();

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const alias of fieldAliases) {
      lookup.set(normalizeHeaderLabel(alias), field);
    }
  }

  return lookup;
}

module.exports = {
  DEFAULT_REQUIRED_FIELDS,
  FIELD_ALIASES,
  normalizeHeaderLabel,
  mapHeaders,
};
