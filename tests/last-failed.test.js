const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { getScreenshotFileName } = require('../scripts/run');
const { loadStore } = require('../scripts/comparison-reports');

test('last-failed references and tests select exact failed pages at all sizes, preserving unrelated baselines and reports', async t => {
  const f = await fixture(t);
  f.config.viewports.push({ label: 'wide', width: 200, height: 100 }); await f.save();
  await f.run(['reference', '--workers=2']);
  const otherNames = f.config.viewports.map(viewport => getScreenshotFileName(f.config.scenarios[1], viewport));
  const baseline = name => fs.readFile(path.join(f.directory, '.reg/reference', name));
  const originals = await Promise.all(otherNames.map(baseline));
  f.pages['/one'] += '<style>@media(min-width:150px){body{background:red}}</style>';
  await f.run(['test', '--workers=2'], 1);
  const reportPath = path.join(f.directory, '.reg/run/out.json');
  const originalReport = await fs.readFile(reportPath);
  assert.equal(JSON.parse(originalReport).failedItems.length, 1, 'only the wide capture differs');
  f.requests.length = 0;
  await f.run(['reference', '--last-failed', '--workers=2']);
  assert.equal(f.requests.filter(url => url === '/one').length, 2);
  assert(!f.requests.includes('/two'));
  assert.deepEqual(await Promise.all(otherNames.map(baseline)), originals);
  assert.deepEqual(await fs.readFile(reportPath), originalReport, 'reference capture retains the comparison report');
  await f.run(['approve'], 1); // A reference run invalidates the old approval manifest.
  f.requests.length = 0;
  await f.run(['test', '--last-failed', '--workers=2']);
  assert.equal(f.requests.filter(url => url === '/one').length, 2);
  assert(!f.requests.includes('/two'));
  const result = JSON.parse(await fs.readFile(reportPath));
  assert.equal(result.passedItems.length, 2);
  const manifest = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/capture-manifest.json')));
  assert.equal(manifest.fullRun, false);
  assert.equal(manifest.fileNames.length, 2);
  const all = await loadStore(f.directory);
  assert.equal(all.state.items.length, 4);
  assert(all.state.items.every(item => item.status === 'passedItems'));
  const history = await fs.readFile(path.join(f.directory, 'results.json'));
  const pointer = await fs.readFile(path.join(f.directory, '.reg/reports/latest.json'));
  f.requests.length = 0;
  assert.match((await f.run(['test', '--last-failed'])).stdout, /Nothing to capture/);
  assert.match((await f.run(['reference', '--last-failed'])).stdout, /Nothing to capture/);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'results.json')), history);
  assert.deepEqual(await fs.readFile(path.join(f.directory, '.reg/reports/latest.json')), pointer);
  assert.deepEqual(await Promise.all(otherNames.map(baseline)), originals);
});

test('last-failed uses screenshot identity rather than broadly matching shared URLs', async t => {
  const f = await fixture(t);
  f.config.scenarios = [
    { url: '/one', label: 'First variant', onReadyScript: ['hooks/apply-css-overrides'] },
    { url: '/one', label: 'Second variant', onReadyScript: ['hooks/apply-css-overrides'] }
  ]; await f.save();
  await f.run(['reference']);
  f.config.scenarios[1].cssOverrides = 'body{background:red}'; await f.save();
  await f.run(['test'], 1);
  f.requests.length = 0;
  const rerun = await f.run(['test', '--last-failed'], 1);
  assert.match(rerun.stdout, /Second variant/);
  assert(!rerun.stdout.includes('First variant'));
  assert.equal(f.requests.filter(url => url === '/one').length, 1);
  const result = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.deepEqual(result.failedItems, [getScreenshotFileName(f.config.scenarios[1], f.config.viewports[0])]);
});

test('missing results, conflicting flags, and obsolete failures cannot trigger a full reference run', async t => {
  const f = await fixture(t);
  await f.run(['reference', '--last-failed'], 1);
  await f.run(['reference', '--last-failed=true'], 1);
  await f.run(['test', '--last-failed', '--filter=one'], 1);
  await f.run(['approve', '--last-failed'], 1);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
  await f.run(['reference']);
  f.pages['/one'] = '<style>body{background:red}</style>';
  await f.run(['test'], 1);
  const previous = await fs.readFile(path.join(f.directory, '.reg/run/out.json'));
  const names = await f.files();
  const references = await Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  f.config.scenarios.shift(); await f.save(); f.requests.length = 0;
  assert.match((await f.run(['reference', '--last-failed'], 1)).stderr, /No current pages match/);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await fs.readFile(path.join(f.directory, '.reg/run/out.json')), previous);
  assert.deepEqual(await Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name)))), references);
});

test('a failed capture retains the previous completed comparison for last-failed selection', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  f.pages['/one'] = '<style>body{background:red}</style>';
  await f.run(['test'], 1);
  f.config.onReadyScript = ['hooks/fail-on-response-status'];
  f.config.defaults.failOnResponseStatusCodes = [503]; await f.save();
  f.pages['/one'] = { status: 503, body: 'Unavailable' };
  await f.run(['test', '--last-failed'], 1);
  await f.run(['approve'], 1);
  f.pages['/one'] = '<h1>One</h1>'; f.requests.length = 0;
  await f.run(['test', '--last-failed']);
  assert(f.requests.includes('/one'));
  assert(!f.requests.includes('/two'));
});

test('last-failed includes new pages that do not yet have reference screenshots', async t => {
  const f = await fixture(t);
  await f.run(['test'], 1);
  const result = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.equal(result.newItems.length, 2);
  await f.run(['reference', '--last-failed']);
  assert.equal((await f.files()).length, 2);
  await f.run(['test', '--last-failed']);
});
