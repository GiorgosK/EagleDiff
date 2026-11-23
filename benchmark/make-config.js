#!/usr/bin/env node
// Write a benchmark's eaglediff/config.json: Eaglediff's defaults with the
// site URL, viewports and pages from bugs.json, and no other changes.
// The setup scripts run this; run it again after updating Eaglediff.
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
const bugs = JSON.parse(fs.readFileSync(path.join(dir, 'bugs.json'), 'utf8'));
// Eaglediff's own defaults only: a user's team defaults must not change results.
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config-default.json'), 'utf8'));
const config = {
  ...defaults,
  referenceBaseURL: bugs.baseURL,
  testBaseURL: bugs.baseURL,
  viewports: bugs.viewports,
  scenarios: bugs.pages.map(page => ({ label: page.id, url: page.url }))
};
fs.mkdirSync(path.join(dir, 'eaglediff'), { recursive: true });
fs.writeFileSync(path.join(dir, 'eaglediff', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote benchmark/${benchmark}/eaglediff/config.json`);
