#!/usr/bin/env node
// Point a BackstopJS project at a benchmark, keeping BackstopJS's own defaults.
// Run `npx backstop init` in an empty folder first, then:
//
//   node benchmark/backstop/make-config.js <benchmark> <backstop folder>
//
// Every scenario copies the default scenario from `backstop init`; only the
// label, URL, viewports and report format change. Set CHROME_BIN to use an
// installed Chrome instead of the browser downloaded with BackstopJS.
const fs = require('fs');
const path = require('path');

const [benchmark, folder] = process.argv.slice(2);
if (!benchmark || !folder) {
  console.error('Usage: node make-config.js <benchmark> <backstop folder>');
  process.exit(2);
}
const configPath = path.resolve(folder, 'backstop.json');
if (!fs.existsSync(configPath)) {
  console.error(`No backstop.json in ${folder}: run \`npx backstop init\` there first.`);
  process.exit(1);
}
const bugs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', benchmark, 'bugs.json'), 'utf8'));
const init = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const [template] = init.scenarios;
const args = [...(init.engineOptions?.args || [])];
// The DDEV benchmark sites use a local HTTPS certificate.
if (bugs.baseURL.startsWith('https:') && !args.includes('--ignore-certificate-errors')) args.push('--ignore-certificate-errors');
const config = {
  ...init,
  id: benchmark,
  viewports: bugs.viewports,
  scenarios: bugs.pages.map(page => ({ ...template, label: page.id, url: bugs.baseURL + page.url })),
  // The JSON report is what flagged.js reads; keep the HTML report for review.
  report: [...new Set([...(init.report || []), 'json'])],
  engineOptions: { ...init.engineOptions, args, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) }
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${configPath} for ${benchmark}: ${config.scenarios.length} pages, ${config.viewports.length} viewports`);
