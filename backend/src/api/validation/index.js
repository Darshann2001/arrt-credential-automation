'use strict';

const common = require('./common');
const records = require('./records');
const jobs = require('./jobs');
const dashboard = require('./dashboard');

module.exports = {
  ...common,
  ...records,
  ...jobs,
  ...dashboard,
};
