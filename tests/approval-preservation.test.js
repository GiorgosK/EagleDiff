const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { getScreenshotFileName } = require('../scripts/run');

test('filtered test approval preserves unrelated baselines and rejects incomplete captures', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  const names = f.config.scenarios.map(s => getScreenshotFileName(s, f.config.viewports[0]));
  const read = name => fs.readFile(path.join(f.directory, '.reg/reference', name));
  const original = await Promise.all(names.map(read));
  await f.run(['test', '--filter=/one']);
  const actual = path.join(f.directory, '.reg/run/actual', names[0]);
  const image = await fs.readFile(actual);
  await fs.writeFile(actual, 'corrupt');
  await f.run(['approve'], 1);
  assert.deepEqual(await Promise.all(names.map(read)), original);
  await fs.writeFile(actual, image);
  await f.run(['approve']);
  assert.equal((await f.files()).length, 2);
  assert.deepEqual(await read(names[1]), original[1]);
  assert.deepEqual(await read(names[0]), image);
  await f.run(['test']);
  await fs.rm(path.join(f.directory, '.reg/run/actual', names[1]));
  await f.run(['approve'], 1);
  assert.deepEqual(await Promise.all(names.map(read)), original);
});

test('full approval removes deleted baselines while an approval filter preserves them', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  f.config.scenarios.pop(); await f.save();
  await f.run(['test'], 1);
  await f.run(['approve', '--filter=/one']);
  assert.equal((await f.files()).length, 2);
  await f.run(['approve']);
  assert.equal((await f.files()).length, 1);
});
