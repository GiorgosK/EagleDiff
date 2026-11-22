const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const cliFixture = require('./helpers/cli-fixture');
const { mergeAgencyDefaults } = require('../scripts/agency-defaults');
const template = require('../config-default.json');

const agency = {
  core: { thresholdRate: 0.002 },
  defaults: { hideDynamicSelectors: ['.agency-chat', template.defaults.hideDynamicSelectors[0]], delay: 800 },
  onReadyScript: ['/srv/agency/hooks/close-popups.js'],
  viewports: [{ label: 'desktop', width: 1440, height: 900 }]
};

test('agency lists of text add to Eaglediff defaults; other values and lists replace them', () => {
  const before = structuredClone(template);
  const merged = mergeAgencyDefaults(template, agency);
  assert.deepEqual(template, before, 'Eaglediff defaults are not mutated');
  assert.deepEqual(merged.defaults.hideDynamicSelectors, [...template.defaults.hideDynamicSelectors, '.agency-chat']);
  assert.deepEqual(merged.onReadyScript, [...template.onReadyScript, '/srv/agency/hooks/close-popups.js']);
  assert.deepEqual(merged.viewports, agency.viewports);
  assert.equal(merged.defaults.delay, 800);
  assert.equal(merged.core.thresholdRate, 0.002);
  assert.equal(merged.core.workers, template.core.workers, 'unset nested values keep Eaglediff defaults');
  assert.equal(merged.version, template.version);
});

async function writeAgencyFile(directory, name, value) {
  const file = path.join(directory, name);
  await fs.writeFile(file, JSON.stringify(value));
  return file;
}

test('config-update --defaults fills missing settings from the agency file and keeps saved ones', async t => {
  const fixture = await cliFixture(t);
  const file = await writeAgencyFile(fixture.directory, 'agency.json', agency);
  await fixture.run(['config-update', '--defaults', file]);
  const updated = JSON.parse(await fs.readFile(path.join(fixture.directory, 'config.json'), 'utf8'));
  assert.equal(updated.core.thresholdRate, 0, 'saved project value wins');
  assert.equal(updated.defaults.delay, 0, 'saved project value wins');
  assert.ok(updated.defaults.hideDynamicSelectors.includes('.agency-chat'), 'missing list comes from the agency');
  assert.ok(updated.defaults.hideDynamicSelectors.includes(template.defaults.hideDynamicSelectors[1]));
  assert.deepEqual(updated.viewports, fixture.config.viewports, 'saved viewports are kept');
});

test('the user defaults file applies to new configs; EAGLEDIFF_DEFAULTS=none turns it off', async t => {
  const fixture = await cliFixture(t);
  const configHome = path.join(fixture.directory, 'xdg');
  await fs.mkdir(path.join(configHome, 'eaglediff'), { recursive: true });
  await writeAgencyFile(path.join(configHome, 'eaglediff'), 'defaults.json', agency);
  const configPath = path.join(fixture.directory, 'config.json');
  const create = async env => {
    await fs.rm(configPath);
    await fixture.run(['config', `--ref=${fixture.baseURL}`, '--limit=1'], 0, env);
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  };

  const withAgency = await create({ XDG_CONFIG_HOME: configHome, EAGLEDIFF_DEFAULTS: '' });
  assert.ok(withAgency.defaults.hideDynamicSelectors.includes('.agency-chat'));
  assert.deepEqual(withAgency.viewports, agency.viewports);
  assert.equal(withAgency.defaults.delay, 800);
  assert.equal(withAgency.version, template.version);

  const without = await create({ XDG_CONFIG_HOME: configHome, EAGLEDIFF_DEFAULTS: 'none' });
  assert.deepEqual(without.defaults.hideDynamicSelectors, template.defaults.hideDynamicSelectors);
  assert.deepEqual(without.viewports, template.viewports);
});

test('an invalid or missing defaults file stops before the config changes', async t => {
  const fixture = await cliFixture(t);
  const configPath = path.join(fixture.directory, 'config.json');
  const before = await fs.readFile(configPath, 'utf8');
  const projectKeys = await writeAgencyFile(fixture.directory, 'project.json', { scenarios: [], defaults: { delay: 1 } });
  const notObject = await writeAgencyFile(fixture.directory, 'list.json', ['.a']);
  for (const [file, message] of [
    [path.join(fixture.directory, 'missing.json'), /Defaults file not found: .*missing\.json/],
    [projectKeys, /cannot set scenarios; these belong in each\s+project config/],
    [notObject, /must contain a JSON object/]
  ]) {
    const result = await fixture.run(['config-update', `--defaults=${file}`], 1);
    assert.match(result.stderr, message);
    assert.equal(await fs.readFile(configPath, 'utf8'), before);
  }
});
