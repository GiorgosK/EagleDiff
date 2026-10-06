const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');

test('adds default extension exclusions and preserves custom or empty lists', () => {
  assert.deepEqual(updateConfig({}, template).excludeExtensions, ['.pdf']);
  for (const excludeExtensions of [['.pdf', '.zip'], []]) {
    assert.deepEqual(updateConfig({ excludeExtensions }, template).excludeExtensions, excludeExtensions);
  }
});

test('adds missing nested settings while preserving user values and scenario overrides', () => {
  const current = {
    referenceBaseURL: 'https://live.test', testBaseURL: 'https://local.test',
    core: { thresholdRate: 0, custom: true },
    defaults: {
      delay: 0, fullPage: false, readySelector: '', waitUntilGone: [],
      browserVerification: null, replaceContent: { '.title': 'Fixed' },
      waitForStableContent: { selectors: ['.custom'], timeout: 42 }
    },
    viewports: [], scenarios: [{ url: '/mine', delay: 3, onReadyScript: ['./custom.js'] }],
    custom: { enabled: true }
  };
  const original = structuredClone(current);
  const result = updateConfig(current, template);
  assert.deepEqual(current, original);
  assert.equal(result.version, template.version);
  assert.equal(result.core.workers, template.core.workers);
  for (const key of ['referenceBaseURL', 'testBaseURL', 'viewports', 'scenarios', 'custom']) {
    assert.deepEqual(result[key], current[key]);
  }
  for (const key of ['delay', 'fullPage', 'readySelector', 'waitUntilGone', 'browserVerification', 'replaceContent']) {
    assert.deepEqual(result.defaults[key], current.defaults[key]);
  }
  assert.equal(result.core.thresholdRate, 0);
  assert.equal(result.core.custom, true);
  assert.equal(result.core.protocolTimeout, template.core.protocolTimeout);
  assert.deepEqual(result.defaults.waitForStableContent, {
    ...template.defaults.waitForStableContent, ...current.defaults.waitForStableContent
  });
  assert.deepEqual(updateConfig(result, template), result);
});

test('inserts new hooks in default order, recognizing aliases and retaining custom order', () => {
  const current = { onReadyScript: ['custom/start', 'scripts/hooks/replace-random-content.js', 'custom/middle', 'hooks/keep-selectors', 'custom/end'] };
  const defaults = { version: template.version, onReadyScript: [
    'hooks/replace-random-content', 'hooks/apply-css-overrides', 'hooks/normalize-image-decoding', 'hooks/keep-selectors', 'hooks/wait-for-background-images'
  ] };
  const updated = updateConfig(current, defaults);
  assert.deepEqual(updated.onReadyScript, [
    'custom/start', 'scripts/hooks/replace-random-content.js', 'custom/middle',
    'hooks/apply-css-overrides', 'hooks/normalize-image-decoding', 'hooks/keep-selectors',
    'hooks/wait-for-background-images', 'custom/end'
  ]);
  assert.deepEqual(updateConfig(updated, defaults), updated);
  assert.deepEqual(updateConfig({ onReadyScript: [] }, defaults).onReadyScript, defaults.onReadyScript);
  assert.equal(updateConfig({ onReadyScript: null }, defaults).onReadyScript, null);
  assert.deepEqual(updateConfig({ onBeforeScript: './custom.js' }, {
    version: template.version, onBeforeScript: ['hooks/new']
  }).onBeforeScript, ['./custom.js', 'hooks/new']);
});

test('never reorders existing hooks, even when they differ from the defaults', () => {
  const result = updateConfig({ onReadyScript: ['hooks/c', 'custom', 'hooks/a'] }, {
    version: template.version, onReadyScript: ['hooks/a', 'hooks/b', 'hooks/c']
  });
  assert.deepEqual(result.onReadyScript.filter(hook => hook !== 'hooks/b'), ['hooks/c', 'custom', 'hooks/a']);
});

test('version upgrades are numeric and newer configs cannot be downgraded', () => {
  assert.equal(updateConfig({ version: '2026.09.26.09' }, { version: '2026.09.26.10' }).version, '2026.09.26.10');
  const newer = template.version.replace(/\d+$/, revision => String(Number(revision) + 1).padStart(2, '0'));
  assert.throws(() => updateConfig({ version: newer }, template), /newer/);
  assert.throws(() => updateConfig({ version: 'bad' }, template), /Invalid version/);
  for (const invalid of [null, [], 'config']) assert.throws(() => updateConfig(invalid, template), /JSON object/);
});

test('config-update CLI updates only the selected config, is repeatable, and leaves invalid input untouched', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-config-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  const run = () => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/reg-suit.js'), '--dir', directory,
    '--script-dir', path.join(__dirname, '..'), 'config-update'
  ], { env: { ...process.env, REG_SUIT_DIR: directory,
    REG_SUIT_CONFIG: configPath, GLOBAL_REG_SUIT_CONFIG: configPath } });
  await fs.writeFile(configPath, JSON.stringify({ defaults: { delay: 7 }, scenarios: [] }));
  assert((await run()).stdout.includes(`Updated config.json to ${template.version}`));
  const saved = await fs.readFile(configPath, 'utf8');
  assert.equal(JSON.parse(saved).defaults.delay, 7);
  assert.equal(Object.keys(JSON.parse(saved))[0], 'version');
  const { version, ...rest } = JSON.parse(saved);
  await fs.writeFile(configPath, JSON.stringify({ ...rest, version }));
  assert.match((await run()).stdout, /Updated config.json/);
  assert.equal(await fs.readFile(configPath, 'utf8'), saved);
  assert.match((await run()).stdout, /already up to date/);
  assert.equal(await fs.readFile(configPath, 'utf8'), saved);
  assert.deepEqual(await fs.readdir(directory), ['config.json']);
  for (const invalid of ['{broken', JSON.stringify({ version: '2027.01.01.01' })]) {
    await fs.writeFile(configPath, invalid);
    await assert.rejects(run());
    assert.equal(await fs.readFile(configPath, 'utf8'), invalid);
  }
  await fs.unlink(configPath);
  await assert.rejects(run());
  assert.deepEqual(await fs.readdir(directory), []);
});
