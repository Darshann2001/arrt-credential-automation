'use strict';

/**
 * Field names used by the extraction pipeline.
 *
 * `EXTRACTED_FIELDS` are part of every accepted record. `recordId` is optional
 * and only used when the source page exposes a reliable record identifier.
 */

const EXTRACTED_FIELDS = Object.freeze([
  'fullName',
  'city',
  'state',
  'credentialString',
]);

const OPTIONAL_FIELDS = Object.freeze(['recordId']);

const ALL_FIELDS = Object.freeze([...EXTRACTED_FIELDS, ...OPTIONAL_FIELDS]);

module.exports = {
  EXTRACTED_FIELDS,
  OPTIONAL_FIELDS,
  ALL_FIELDS,
};
