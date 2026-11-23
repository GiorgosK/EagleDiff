#!/usr/bin/env node
// Score a visual regression run against a benchmark's bugs.json.
//
//   node score.js <benchmark> flagged.txt        one "<page id> <viewport>" per
//                                                line, from any tool ("<id> error"
//                                                for a capture error on that page)
//   node score.js <benchmark> --eaglediff <dir>  read Eaglediff's latest comparison
//
// <benchmark> is a benchmark folder, such as drupal-umami or wordpress-elementor.
const fs = require('fs');
const path = require('path');

function flaggedFromEaglediff(dir) {
  const { getScreenshotFileName } = require('../scripts/run');
  const out = JSON.parse(fs.readFileSync(path.join(dir, '.reg', 'run', 'out.json'), 'utf8'));
  const changed = new Set([...out.failedItems, ...out.newItems, ...out.deletedItems]);
  return bugs.pages.flatMap(page => bugs.viewports
    .filter(viewport => changed.has(getScreenshotFileName({ label: page.id, url: page.url }, viewport)))
    .map(viewport => `${page.id} ${viewport.label}`));
}

const [benchmark, ...args] = process.argv.slice(2);
if (!benchmark || !args.length) {
  console.error('Usage: node score.js <benchmark> flagged.txt | node score.js <benchmark> --eaglediff <dir>');
  process.exit(2);
}
const bugs = JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, benchmark), 'bugs.json'), 'utf8'));
const flagged = new Set(args[0] === '--eaglediff'
  ? flaggedFromEaglediff(path.resolve(args[1] || 'eaglediff'))
  : fs.readFileSync(args[0], 'utf8').split('\n').map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean));

let caught = 0; let falseAlarms = 0;
const rows = bugs.pages.map(page => {
  const hits = bugs.viewports.map(({ label }) => flagged.has(`${page.id} ${label}`) || flagged.has(`${page.id} error`));
  const expected = bugs.viewports.map(({ label }) => page.visibleAt.includes(label));
  const found = hits.some((hit, index) => hit && expected[index]);
  if (page.bug && found) caught++;
  const wrong = hits.filter((hit, index) => hit && !expected[index]).length;
  falseAlarms += wrong;
  const cells = hits.map((hit, index) => expected[index] ? (hit ? 'caught' : 'MISSED') : (hit ? 'FALSE' : '-'));
  return [page.id, ...cells, page.bug || '(control page, no bug)'];
});
const widths = [4, ...bugs.viewports.map(() => 7)];
console.log(['page', ...bugs.viewports.map(v => v.label)].map((cell, i) => cell.padEnd(widths[i])).join(' ') + ' bug');
for (const row of rows) console.log(row.map((cell, i) => i < widths.length ? cell.padEnd(widths[i]) : cell).join(' '));
const total = bugs.pages.filter(page => page.bug).length;
console.log(`\nBugs caught (on at least one viewport where visible): ${caught}/${total}`);
console.log(`False alarms (flagged where nothing changed): ${falseAlarms}`);
