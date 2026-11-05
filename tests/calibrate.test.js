const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { getReportPath } = require('../scripts/report');

test('calibrate uses the reference site for one run, preserves config and references, and normal test still uses its saved destination', async t => {
  const f = await fixture(t);
  f.config.testBaseURL = f.baseURL + '/target'; await f.save();
  f.pages['/target/one'] = f.pages['/target/two'] = '<style>body{background:red}</style>';
  await f.run(['reference', '--workers=2']);
  const configPath = path.join(f.directory, 'config.json');
  const config = await fs.readFile(configPath);
  const names = await f.files();
  const readReferences = () => Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  const references = await readReferences();
  f.requests.length = 0;
  await f.run(['calibrate', '--workers=2']);
  assert(f.requests.includes('/one')); assert(f.requests.includes('/two'));
  assert(!f.requests.some(url => url.startsWith('/target/')));
  assert.deepEqual(await fs.readFile(configPath), config);
  assert.deepEqual(await readReferences(), references);
  const results = JSON.parse(await fs.readFile(path.join(f.directory, 'results.json')));
  assert.equal(results[0].ref, f.config.referenceBaseURL);
  assert.equal(results[0].test, f.config.referenceBaseURL);
  assert.equal(results[0].passed, 2);
  assert.equal(await getReportPath(f.directory), path.join(f.directory, '.reg/run/index.html'));
  f.requests.length = 0;
  await f.run(['test'], 1);
  assert(f.requests.includes('/target/one'));
  assert.deepEqual(await fs.readFile(configPath), config);
});

test('calibrate respects referenceUrl paths and filters, and differences still fail without replacing references', async t => {
  const f = await fixture(t);
  f.pages['/original'] = '<h1>Reference page</h1>';
  f.pages['/changed'] = '<style>body{background:red}</style>';
  f.config.scenarios[0] = { label: 'Different paths', referenceUrl: '/original', url: '/changed' };
  await f.save(); await f.run(['reference']);
  const names = await f.files();
  const references = await Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  f.requests.length = 0;
  await f.run(['calibrate', '--filter=Different paths']);
  assert(f.requests.includes('/original'));
  assert(!f.requests.includes('/changed')); assert(!f.requests.includes('/two'));
  const outPath = path.join(f.directory, '.reg/run/out.json');
  assert.equal(JSON.parse(await fs.readFile(outPath)).passedItems.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/capture-manifest.json'))).fullRun, false);
  f.config.scenarios[0].referenceUrl = f.baseURL + '/original'; await f.save();
  f.requests.length = 0;
  await f.run(['calibrate', '--filter=Different paths', '--workers=2']);
  assert(f.requests.includes('/original')); assert(!f.requests.includes('/changed'));
  f.pages['/original'] = '<style>body{background:blue}</style>';
  await f.run(['calibrate', '--filter=Different paths'], 1);
  assert.equal(JSON.parse(await fs.readFile(outPath)).failedItems.length, 1);
  assert.deepEqual(await Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name)))), references);
});

test('calibrate requires existing references before making requests or changing reports', async t => {
  const f = await fixture(t);
  assert.match((await f.run(['calibrate'], 1)).stderr, /Run eaglediff reference first/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
});

test('failed calibration capture preserves references and history and cannot be approved', async t => {
  const f = await fixture(t);
  await f.run(['reference']); await f.run(['calibrate']);
  const names = await f.files();
  const readReferences = () => Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  const references = await readReferences();
  const historyPath = path.join(f.directory, 'results.json'); const history = await fs.readFile(historyPath);
  f.config.onReadyScript = ['hooks/fail-on-response-status'];
  f.config.defaults.failOnResponseStatusCodes = [503]; await f.save();
  f.pages['/one'] = { status: 503, body: 'Unavailable' };
  await f.run(['calibrate'], 1); await f.run(['approve'], 1);
  assert.deepEqual(await readReferences(), references);
  assert.deepEqual(await fs.readFile(historyPath), history);
});
