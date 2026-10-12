const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');

test('keepSelectors clips the saved PNG using bounds after final hooks and removals', async t => {
  const f = await fixture(t);
  f.pages['/one'] = '<style>body{margin:0}#target{width:20px;height:30px}</style><header style="height:40px"></header><div id="target"></div>';
  f.config.scenarios = [{ url: '/one' }];
  f.config.defaults.keepSelectors = ['#target'];
  f.config.defaults.removeSelectors = ['header'];
  const hook = path.join(f.directory, 'resize.js');
  await fs.writeFile(hook, `module.exports = page => page.$eval('#target', e => { e.style.width='40px'; e.style.height='50px'; });`);
  f.config.onReadyScript = ['hooks/keep-selectors', hook];
  await f.save(); await f.run(['reference']);
  const png = await fs.readFile(path.join(f.directory, '.reg/reference', (await f.files())[0]));
  assert.equal(png.readUInt32BE(16), 40);
  assert.equal(png.readUInt32BE(20), 50);
  f.config.defaults.keepSelectors = ['#missing']; await f.save();
  const result = await f.run(['reference'], 1);
  assert.match(result.stderr, /keepSelectors selector not found/);
});
