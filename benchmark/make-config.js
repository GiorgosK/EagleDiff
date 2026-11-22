#!/usr/bin/env node
// Build a benchmark's eaglediff/config.json from three visible sources:
//   1. Eaglediff's defaults (config-default.json)
//   2. eaglediff/defaults.json, if present: the settings tuned for this site,
//      in the team defaults format (see "Team or agency defaults" in docs)
//   3. bugs.json: base URL, viewports and pages
//
//   node make-config.js <benchmark>
const fs = require('fs');
const path = require('path');

const benchmark = process.argv[2];
if (!benchmark) {
  console.error('Usage: node make-config.js <benchmark>');
  process.exit(2);
}
const dir = path.resolve(__dirname, benchmark);
const overrides = path.join(dir, 'eaglediff', 'defaults.json');
process.env.EAGLEDIFF_DEFAULTS = fs.existsSync(overrides) ? overrides : 'none';
const { loadDefaults } = require('../scripts/agency-defaults');
const bugs = JSON.parse(fs.readFileSync(path.join(dir, 'bugs.json'), 'utf8'));
const { version, ...defaults } = loadDefaults();
const config = {
  version,
  referenceBaseURL: bugs.baseURL,
  testBaseURL: bugs.baseURL,
  ...defaults,
  referenceBaseURL: bugs.baseURL,
  testBaseURL: bugs.baseURL,
  viewports: bugs.viewports,
  scenarios: bugs.pages.map(page => ({ label: page.id, url: page.url }))
};
fs.writeFileSync(path.join(dir, 'eaglediff', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${benchmark}/eaglediff/config.json${fs.existsSync(overrides) ? ' with eaglediff/defaults.json' : ''}`);
