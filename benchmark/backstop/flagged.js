#!/usr/bin/env node
// Turn BackstopJS's JSON report into the benchmark's flagged list:
// "<page id> <viewport>" for each failed comparison, "<page id> error" for a
// capture error. Score it with benchmark/score.js.
//
//   node benchmark/backstop/flagged.js <backstop folder> > flagged.txt
const fs = require('fs');
const path = require('path');

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node flagged.js <backstop folder>');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(path.resolve(folder, 'backstop_data/json_report/jsonReport.json'), 'utf8'));
const lines = new Set();
for (const { pair, status } of report.tests) {
  if (pair.engineErrorMsg) lines.add(`${pair.label} error`);
  else if (status !== 'pass') lines.add(`${pair.label} ${pair.viewportLabel}`);
}
for (const line of lines) console.log(line);
