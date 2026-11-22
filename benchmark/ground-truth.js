#!/usr/bin/env node
// Record where each bug changes pixels (visibleAt in bugs.json) from an
// Eaglediff run with zero thresholds:
//   core.thresholdRate 0, core.thresholdRateColor 0, core.thresholdMaxPixels null.
// Run the clean site through calibrate first: any change there means the
// site is not stable enough for pixel-exact ground truth.
//
//   node ground-truth.js <benchmark> <eaglediff dir>
const fs = require('fs');
const path = require('path');
const { getScreenshotFileName } = require('../scripts/run');

const [benchmark, dir] = process.argv.slice(2);
if (!benchmark || !dir) {
  console.error('Usage: node ground-truth.js <benchmark> <eaglediff dir>');
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const strict = config.core?.thresholdRate === 0 && config.core?.thresholdRateColor === 0
  && config.core?.thresholdMaxPixels == null;
if (!strict) {
  console.error('The Eaglediff config must use zero thresholds and no pixel cap.');
  process.exit(2);
}
const file = path.join(path.resolve(__dirname, benchmark), 'bugs.json');
const bugs = JSON.parse(fs.readFileSync(file, 'utf8'));
const out = JSON.parse(fs.readFileSync(path.join(dir, '.reg', 'run', 'out.json'), 'utf8'));
// A failed capture (for example a broken image) is listed as deleted.
const changed = new Set([...out.failedItems, ...out.newItems, ...out.deletedItems]);
for (const page of bugs.pages) {
  page.visibleAt = bugs.viewports.map(viewport => viewport.label)
    .filter((label, index) => changed.has(getScreenshotFileName({ label: page.id, url: page.url }, bugs.viewports[index])));
  if (!page.bug && page.visibleAt.length) console.warn(`Control page ${page.id} changed: ${page.visibleAt.join(', ')}`);
  if (page.bug && !page.visibleAt.length) console.warn(`Bug ${page.id} changed no pixels.`);
}
// One page per line keeps the file easy to read and review.
const json = JSON.stringify(bugs, null, 2).replace(/\{\n\s+"id": ([\s\S]*?)\n\s+\}/g,
  match => match.replace(/\n\s+/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']'));
fs.writeFileSync(file, json + '\n');
console.log(`Updated ${path.relative(process.cwd(), file)}`);
