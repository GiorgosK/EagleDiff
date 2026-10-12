const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');

test('changed, new, and deleted captures fail the CLI while preserving reports and history', async t => {
  const f = await fixture(t);
  const out = () => fs.readFile(path.join(f.directory, '.reg/run/out.json')).then(JSON.parse);
  await f.run(['reference']);
  await f.run(['test']);
  f.pages['/one'] = '<h1>A different page</h1>';
  await f.run(['test'], 1);
  assert.equal((await out()).failedItems.length, 1);
  await fs.access(path.join(f.directory, '.reg/run/index.html'));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'results.json'))).length, 2);
  await f.run(['approve']);
  await f.run(['test']);
  f.config.scenarios.push({ url: '/three' }); await f.save();
  await f.run(['test'], 1);
  assert.equal((await out()).newItems.length, 1);
  f.config.scenarios = [{ url: '/one' }]; await f.save();
  await f.run(['test'], 1);
  assert.equal((await out()).deletedItems.length, 1);
});
