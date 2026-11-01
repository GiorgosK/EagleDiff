const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fixture = require('./helpers/cli-fixture');

test('projects nested inside the checkout compare their own staged screenshots', async t => {
  const f = await fixture(t);
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(root, '.comparison-path-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    ...f.config, scenarios: [{ url: '/one' }]
  }));
  const run = async (command, expectedExit = 0) => {
    let result;
    try {
      result = await promisify(execFile)(process.execPath, [
        path.join(root, 'bin/eaglediff.js'), '--dir', directory,
        '--script-dir', root, command
      ], {
        cwd: root, timeout: 30000,
        env: { ...process.env, INIT_CWD: '', EAGLEDIFF_DIR: '', EAGLEDIFF_PROJECT_DIR: '', EAGLEDIFF_ROOT: '', EAGLEDIFF_CONFIG: '', GLOBAL_EAGLEDIFF_CONFIG: '', npm_config_config: '', npm_config_workers: '' }
      });
      result.code = 0;
    } catch (error) { result = error; }
    assert.equal(result.code, expectedExit, `${result.stdout || ''}\n${result.stderr || ''}`);
  };
  await run('reference');
  await run('test');
  const generated = JSON.parse(await fs.readFile(path.join(directory, '.reg/regconfig.generated.json')));
  assert(path.isAbsolute(generated.core.actualDir), 'comparison input must not resolve relative to the enclosing repository');
  assert.equal(generated.core.actualDir, path.join(directory, '.reg/staging/screenshots'));
  const staged = await fs.readdir(generated.core.actualDir);
  assert.equal(staged.length, 1);
  const out = () => fs.readFile(path.join(directory, '.reg/run/out.json')).then(JSON.parse);
  assert.equal((await out()).passedItems.length, 1);
  f.pages['/one'] = '<h1>A deliberate changed heading</h1>';
  await run('test', 1);
  assert.equal((await out()).failedItems.length, 1);
  await fs.access(path.join(directory, '.reg/run/index.html'));
});
