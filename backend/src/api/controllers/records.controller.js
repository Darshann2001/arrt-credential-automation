'use strict';

const { asyncHandler } = require('../middleware/async-handler');

/**
 * @param {{ recordsService: object, importService: object }} deps
 */
function createRecordsController({ recordsService, importService }) {
  const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await recordsService.list(req.validated.query);
    res.json({ data: rows, pagination });
  });

  const getById = asyncHandler(async (req, res) => {
    const record = await recordsService.getById(req.validated.params.id);
    res.json({ data: record });
  });

  const importRecords = asyncHandler(async (req, res) => {
    const result = await importService.importRecords(req.validated.body);
    res.status(200).json({ data: result });
  });

  return { list, getById, importRecords };
}

module.exports = { createRecordsController };
