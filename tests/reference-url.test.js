const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { buildImportedConfig } = require('../scripts/import');
const template = require('../config-default.json');

test('imported distinct reference paths are captured and compared under the same identity', async t => {
  const f = await fixture(t);
  f.pages['/old'] = f.pages['/new'] = '<h1>Same content</h1>';
  const imported = buildImportedConfig(template, template, {
    scenarios: [{ label: 'Different paths', referenceUrl: f.baseURL + '/old', url: f.baseURL + '/new' }]
  }, path.join(f.directory, 'backstop.json'), path.join(f.directory, 'config.json'));
  assert.deepEqual(imported.scenarios, [{ label: 'Different paths', url: '/new', referenceUrl: '/old' }]);
  f.config.scenarios = imported.scenarios; await f.save();
  await f.run(['reference']);
  assert(f.requests.includes('/old')); assert(!f.requests.includes('/new'));
  const names = await f.files();
  f.requests.length = 0;
  await f.run(['test']);
  assert(f.requests.includes('/new')); assert(!f.requests.includes('/old'));
  assert.deepEqual(await f.files(), names);
  f.config.scenarios[0].referenceUrl = f.baseURL + '/old';
  f.config.core.workers = 2; await f.save();
  f.requests.length = 0; await f.run(['reference']);
  assert(f.requests.includes('/old')); assert(!f.requests.includes('/new'));
});
