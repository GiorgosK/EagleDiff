const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');
const { resolveHttp404Policy } = require('../scripts/hooks/fail-on-response-status');

test('404 warnings allow reference and test captures to finish, including existing error-code lists and parallel workers', async t => {
  const f = await fixture(t);
  f.config.onReadyScript = ['hooks/fail-on-response-status'];
  f.config.defaults.failOnResponseStatusCodes = [404, 503];
  f.config.viewports.push({ label: 'wide', width: 200, height: 100 });
  f.pages['/one'] = { status: 404, body: '<h1>Page not found</h1>' }; await f.save();
  const reference = await f.run(['reference', '--workers=2']);
  assert.equal((reference.stderr.match(/Warning: HTTP 404/g) || []).length, 1, 'warn once per URL across workers');
  assert.match(reference.stderr, /\/one/);
  assert.equal((await f.files()).length, 4);
  assert(f.requests.includes('/two'), 'remaining pages are captured');
  const compared = await f.run(['test', '--workers=2']);
  assert.match(compared.stderr, /Warning: HTTP 404/);
  const result = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.equal(result.passedItems.length, 4);
  f.pages['/one'].body = '<style>body{background:red}</style><h1>Different error page</h1>';
  await f.run(['test', '--filter=/one'], 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json'))).failedItems.length, 2,
    'warning mode does not hide visual differences');
});

test('error policy stops without changing references; scenario overrides win and other HTTP errors remain blocking', async t => {
  const f = await fixture(t);
  f.config.onReadyScript = ['hooks/fail-on-response-status'];
  f.config.defaults.failOnResponseStatusCodes = [404, 503]; await f.save();
  await f.run(['reference']);
  const names = await f.files();
  const read = () => Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  const original = await read();
  f.pages['/one'] = { status: 404, body: '<h1>Missing</h1>' };
  f.config.defaults.http404Policy = 'error'; await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /Blocked response status 404/);
  assert.deepEqual(await read(), original);
  f.config.scenarios[0].http404Policy = 'warn'; await f.save();
  assert.match((await f.run(['test'], 1)).stderr, /Warning: HTTP 404/);
  f.config.defaults.http404Policy = 'warn';
  f.config.scenarios[0].http404Policy = 'error'; await f.save();
  assert.match((await f.run(['test'], 1)).stderr, /Blocked response status 404/);
  delete f.config.scenarios[0].http404Policy; await f.save();
  f.pages['/one'] = { status: 503, body: 'Unavailable' };
  assert.match((await f.run(['reference'], 1)).stderr, /Blocked response status 503/);
  assert.deepEqual(await read(), original);
});

test('invalid 404 policies fail before browser requests or output writes, and config updates retain explicit choices', async t => {
  const f = await fixture(t);
  f.config.defaults.http404Policy = 'ignore'; await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /http404Policy must be/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
  assert.equal(updateConfig({}, template).defaults.http404Policy, 'warn');
  assert.equal(updateConfig({ defaults: { http404Policy: 'error' } }, template).defaults.http404Policy, 'error');
  assert.equal(updateConfig({ scenarios: [{ url: '/', http404Policy: 'error' }] }, template).scenarios[0].http404Policy, 'error');
  assert.equal(resolveHttp404Policy({ defaults: { http404Policy: 'error' } }, { http404Policy: 'warn' }), 'warn');
});
