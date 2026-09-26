const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { checkConfigVersion } = require('../scripts/check-config-version');
const { compareVersions } = require('../scripts/config-version');
const template = require('../config-default.json');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-version-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, configPath: path.join(directory, 'config.json'), scriptDir: path.join(__dirname, '..'), command: 'test' };
}

test('versions compare numerically, including same-day revisions', () => {
  assert.equal(compareVersions('2026.09.26.09', '2026.09.26.10'), -1);
  assert.equal(compareVersions('2027.01.01.01', '2026.12.31.99'), 1);
  assert.equal(compareVersions(template.version, template.version), 0);
});

test('newer configs require confirmation and remain unchanged', async t => {
  const options = await fixture(t);
  const raw = JSON.stringify({ version: '2099.01.01.01' });
  await fs.writeFile(options.configPath, raw);
  const warnings = [];
  for (const answer of [false, true]) {
    let prompted = false;
    assert.equal(await checkConfigVersion(options, { interactive: true, warn: m => warnings.push(m), ask: async question => {
      prompted = true;
      assert.match(question, /Continue/);
      return answer;
    } }), answer);
    assert(prompted);
  }
  assert(warnings.every(m => m.includes(template.version) && m.includes('2099.01.01.01')));
  await assert.rejects(checkConfigVersion(options, { interactive: false, warn: () => {} }), /--allow-newer-config/);
  assert.equal(await checkConfigVersion({ ...options, allowNewer: true }, { interactive: false, warn: () => {} }), true);
  assert.equal(await fs.readFile(options.configPath, 'utf8'), raw);
});

test('older and unversioned configs offer an update, preserve overrides, and allow declining', async t => {
  const options = await fixture(t);
  for (const version of [undefined, '2020.01.01.01']) {
    const raw = JSON.stringify({ version, defaults: { delay: 17 }, onReadyScript: ['custom/hook'], scenarios: [{ url: '/mine' }] });
    await fs.writeFile(options.configPath, raw);
    for (const interactive of [false, true]) {
      assert.equal(await checkConfigVersion(options, { interactive, ask: async () => false, warn: () => {} }), true);
      assert.equal(await fs.readFile(options.configPath, 'utf8'), raw);
    }
    assert.equal(await checkConfigVersion(options, { interactive: true, ask: async question => {
      assert.match(question, /Update config.json/);
      return true;
    }, warn: () => {} }), true);
    const updated = JSON.parse(await fs.readFile(options.configPath, 'utf8'));
    assert.equal(updated.version, template.version);
    assert.equal(updated.defaults.delay, 17);
    assert(updated.onReadyScript.includes('custom/hook'));
    assert(updated.onReadyScript.includes('hooks/apply-css-overrides'));
    assert.deepEqual(updated.scenarios, [{ url: '/mine' }]);
    assert.equal(Object.keys(updated)[0], 'version');
  }
});

test('matching versions, new projects and explicit config-update do not prompt', async t => {
  const options = await fixture(t);
  const unexpected = () => { throw new Error('Unexpected prompt or warning'); };
  const io = { interactive: true, ask: unexpected, warn: unexpected };
  assert.equal(await checkConfigVersion(options, io), true);
  await fs.writeFile(options.configPath, JSON.stringify({ version: template.version }));
  assert.equal(await checkConfigVersion(options, io), true);
  await fs.writeFile(options.configPath, JSON.stringify({ version: '2020.01.01.01' }));
  assert.equal(await checkConfigVersion({ ...options, command: 'config-update' }, io), true);
});

test('CLI blocks newer configs before destructive commands; explicit override continues', async t => {
  const options = await fixture(t);
  await fs.writeFile(options.configPath, JSON.stringify({ version: '2099.01.01.01' }));
  const cache = path.join(options.directory, '.reg');
  await fs.mkdir(cache);
  const run = (...args) => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/reg-suit.js'), '--dir', options.directory, ...args
  ], { timeout: 5000, env: { ...process.env, REG_SUIT_DIR: options.directory,
    REG_SUIT_CONFIG: options.configPath, GLOBAL_REG_SUIT_CONFIG: options.configPath } });
  await assert.rejects(run('clean'), error => {
    assert.match(error.stderr, /newer/);
    assert.match(error.stderr, /--allow-newer-config/);
    return true;
  });
  await fs.access(cache);
  assert.match((await run('help')).stdout, /Usage:/);
  await run('clean', '--allow-newer-config');
  await assert.rejects(fs.access(cache), { code: 'ENOENT' });
});
