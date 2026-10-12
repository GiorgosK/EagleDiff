const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const { resolveHookPath } = require('../scripts/hook-path');

test('all supported bundled hook spellings execute through the capture pipeline', async t => {
  const f = await fixture(t);
  f.config.scenarios = [{ url: '/one' }];
  f.pages['/one'] = '<div id="target"></div>';
  f.config.defaults.cssOverrides = '#target{width:20px;height:30px}';
  f.config.defaults.keepSelectors = ['#target'];
  for (const hook of ['hooks/apply-css-overrides', 'hooks/apply-css-overrides.js', 'scripts/hooks/apply-css-overrides', 'scripts/hooks/apply-css-overrides.js']) {
    f.config.onReadyScript = [hook, 'scripts/hooks/keep-selectors'];
    await f.save(); await f.run(['reference']);
    const png = await fs.readFile(path.join(f.directory, '.reg/reference', (await f.files())[0]));
    assert.equal(png.readUInt32BE(16), 20, hook);
    assert.equal(png.readUInt32BE(20), 30, hook);
  }
});

test('project-relative and absolute custom hook paths retain their meaning', () => {
  const dirs = { helperDir: '/runner', rootDir: '/project' };
  assert.equal(resolveHookPath('./custom', dirs), '/project/custom.js');
  assert.equal(resolveHookPath('/custom/hook.js', dirs), '/custom/hook.js');
});
