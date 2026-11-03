const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./helpers/cli-fixture');
const template = require('../config-default.json');
const { buildImportedConfig } = require('../scripts/import');
const { getScreenshotFileName, validateScreenshotNames } = require('../scripts/run');

function imported(scenarios, onDuplicate = () => {}) {
  return buildImportedConfig(template, template, { scenarios }, '/source/backstop.json', '/project/config.json', { onDuplicate });
}

test('import keeps same-URL variants with distinct labels and reports each repeated URL without adding IDs', () => {
  const source = [
    { url: 'https://example.test/courses', label: 'Courses' },
    { url: 'https://example.test/courses/', label: 'Courses alternate', delay: 42 },
    { url: 'https://example.test/about', label: 'About' },
    { url: 'https://example.test/courses', label: 'Courses full', delay: 100 },
    { url: 'https://example.test/courses', label: 'Courses compact', delay: 100 }
  ];
  const original = structuredClone(source);
  const duplicates = [];
  const config = imported(source, duplicate => duplicates.push(duplicate));
  assert.equal(config.scenarios.length, source.length);
  const variants = config.scenarios.filter(scenario => scenario.url === '/courses');
  assert(config.scenarios.every(scenario => !Object.hasOwn(scenario, 'id')));
  assert.equal(variants[1].delay, 42);
  assert.equal(variants[2].delay, 100);
  assert.equal(variants[3].delay, 100);
  assert.deepEqual(duplicates, [{ url: '/courses', labels: variants.map(scenario => scenario.label) }]);
  validateScreenshotNames(config);
  assert.deepEqual(imported(source), config);
  assert.deepEqual(source, original);
  const reordered = imported([source[1], source[0]]);
  const ordered = imported(source.slice(0, 2));
  assert.deepEqual(reordered.scenarios, ordered.scenarios.slice().reverse());
});

test('import assigns unique IDs only when both URL and label repeat', () => {
  const duplicates = [];
  const source = [
    { url: 'https://example.test/courses', label: 'Courses', delay: 0 },
    { url: 'https://example.test/courses', label: 'Courses', delay: 100 },
    { url: 'https://example.test/courses', label: 'Another label' }
  ];
  const config = imported(source, duplicate => duplicates.push(duplicate));
  const ids = config.scenarios.slice(0, 2).map(scenario => scenario.id);
  assert.equal(new Set(ids).size, 2);
  assert(ids.every(id => typeof id === 'string' && id.length));
  assert.equal(config.scenarios[2].id, undefined);
  assert.deepEqual(duplicates, [{ url: '/courses', labels: ['Courses', 'Courses', 'Another label'], ids: [...ids, undefined] }]);
  assert.deepEqual(imported(source), config);
  assert.deepEqual(imported(source.slice().reverse()).scenarios.map(scenario => scenario.id), config.scenarios.map(scenario => scenario.id).reverse());
  const unlabeled = imported([
    { url: 'https://example.test/courses' },
    { url: 'https://example.test/courses', label: '' }
  ]);
  validateScreenshotNames(unlabeled);
  assert.notEqual(unlabeled.scenarios[0].id, unlabeled.scenarios[1].id);
});

test('import retains unique explicit IDs, repairs repeated IDs, and rejects duplicate viewports', () => {
  const config = imported([
    { url: 'https://example.test/courses', label: 'Courses', id: 'saved' },
    { url: 'https://example.test/courses', label: 'Courses', id: 'saved' },
    { url: 'https://example.test/courses', label: 'Courses' },
    { url: 'https://example.test/courses', label: 'Courses' }
  ]);
  assert.equal(config.scenarios[0].id, 'saved');
  assert.equal(new Set(config.scenarios.map(scenario => scenario.id)).size, 4);
  validateScreenshotNames(config);
  assert.throws(() => buildImportedConfig(template, template, {
    scenarios: [{ url: 'https://example.test/courses' }],
    viewports: [{ label: 'phone', width: 100, height: 100 }, { label: 'phone', width: 100, height: 100 }]
  }, '/source/backstop.json'), /Duplicate screenshot identity/);
});

test('CLI warnings distinguish repeated labels from existing IDs on distinct labels', async t => {
  const f = await fixture(t);
  const backstopPath = path.join(f.directory, 'backstop.json');
  await fs.writeFile(backstopPath, JSON.stringify({ scenarios: [
    { url: f.baseURL + '/one', label: 'First view', id: 'saved-id' },
    { url: f.baseURL + '/one', label: 'Second view' }
  ] }));
  const result = await f.run(['import', `--backstop=${backstopPath}`]);
  assert.match(result.stderr, /Duplicate URL "\/one"/);
  assert.match(result.stderr, /with distinct labels/);
  assert.doesNotMatch(result.stderr, /repeated labels/);
  const config = JSON.parse(await fs.readFile(path.join(f.directory, 'config.json')));
  assert.equal(config.scenarios[0].id, 'saved-id');
  assert.equal(config.scenarios[1].id, undefined);
});

test('CLI import reports duplicate URLs, captures separate variants, and preserves them through config discovery', async t => {
  const f = await fixture(t);
  const backstopPath = path.join(f.directory, 'backstop.json');
  const source = {
    scenarios: [
      { url: f.baseURL + '/one', label: 'Same page', referenceUrl: f.baseURL + '/one' },
      { url: f.baseURL + '/one', label: 'Same page', referenceUrl: f.baseURL + '/two' },
      { url: f.baseURL + '/two', label: 'Other page' }
    ],
    viewports: f.config.viewports
  };
  await fs.writeFile(backstopPath, JSON.stringify(source));
  const result = await f.run(['import', `--backstop=${backstopPath}`]);
  assert.match(result.stderr, /Duplicate URL "\/one"/);
  assert.match(result.stderr, /repeated labels use unique IDs/);
  assert.match(result.stderr, /"Same page" \(id: "variant-/);
  const configPath = path.join(f.directory, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath));
  assert.equal(config.scenarios.length, 3);
  const variants = config.scenarios.slice(0, 2);
  assert.equal(new Set(variants.map(scenario => scenario.id)).size, 2);
  assert.equal(config.scenarios[2].id, undefined);
  f.pages['/'] = '<a href="/one">One</a><a href="/two">Two</a>';
  await f.run(['config']);
  const discovered = JSON.parse(await fs.readFile(configPath));
  assert.deepEqual(discovered.scenarios.filter(scenario => scenario.url === '/one'), variants);
  // Keep only the imported pages for the capture assertions.
  await fs.writeFile(configPath, JSON.stringify(config));
  await f.run(['reference', '--workers=2']);
  assert.equal((await f.files()).length, 3);
  const filenames = config.scenarios.map(scenario => getScreenshotFileName(scenario, config.viewports[0]));
  assert.equal(new Set(filenames).size, 3);
  // Both variants deliberately compare identical content in this fixture.
  f.pages['/one'] = f.pages['/two'] = '<h1>Same content</h1>';
  await f.run(['reference', '--workers=2']);
  await f.run(['test', '--workers=2']);
  const report = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.equal(report.passedItems.length, 3);
  const untouched = await fs.readFile(path.join(f.directory, '.reg/reference', filenames[1]));
  f.pages['/one'] = '<h1>Changed content</h1>';
  await f.run(['test', `--filter=${variants[0].id}`], 1);
  await f.run(['approve', `--filter=${variants[0].id}`]);
  assert.deepEqual(await fs.readFile(path.join(f.directory, '.reg/reference', filenames[1])), untouched);
  assert.equal((await f.files()).length, 3);
  await fs.writeFile(backstopPath, JSON.stringify({ ...source, viewports: [config.viewports[0], config.viewports[0]] }));
  const saved = await fs.readFile(configPath, 'utf8');
  const gitignore = await fs.readFile(path.join(f.directory, '.gitignore'), 'utf8');
  await f.run(['import', `--backstop=${backstopPath}`], 1);
  assert.equal(await fs.readFile(configPath, 'utf8'), saved);
  assert.equal(await fs.readFile(path.join(f.directory, '.gitignore'), 'utf8'), gitignore);
});
