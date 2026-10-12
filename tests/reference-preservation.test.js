const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { getScreenshotFileName } = require('../scripts/run');

test('filtered references preserve unrelated baselines; full references remove obsolete ones', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  const unrelated = getScreenshotFileName(f.config.scenarios[1], f.config.viewports[0]);
  const read = () => fs.readFile(path.join(f.directory, '.reg/reference', unrelated));
  const original = await read();
  f.pages['/one'] = '<h1>Changed</h1>';
  await f.run(['reference', '--filter=/one']);
  assert.equal((await f.files()).length, 2);
  assert.deepEqual(await read(), original);
  f.config.scenarios.pop(); await f.save();
  await f.run(['reference']);
  assert.equal((await f.files()).length, 1);
});
