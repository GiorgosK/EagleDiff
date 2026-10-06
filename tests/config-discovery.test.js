const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeLink, mergeScenarios } = require('../scripts/config');

const base = 'https://example.org/';

test('excludes PDF paths by default, regardless of case, encoding, queries or fragments', () => {
  for (const href of [
    '/themes/custom/thesaas/images/site_covid.pdf', '/file.PDF?download=1#page=2',
    '/file%2Epdf', 'https://example.org/file.pdf'
  ]) {
    assert.equal(normalizeLink(base, { href }), null, href);
  }
  for (const href of ['/pdf-guide', '/file.pdf/preview', '/download?file=guide.pdf']) {
    assert.equal(normalizeLink(base, { href }).url, href);
  }
});

test('uses custom extensions with optional dots and allows disabling exclusions', () => {
  const excluded = [' PDF ', '.ZIP', '.tar.gz'];
  for (const href of ['/file.pdf', '/archive.zip?download=1', '/archive.TAR.GZ']) {
    assert.equal(normalizeLink(base, { href }, excluded), null);
  }
  assert.equal(normalizeLink(base, { href: '/file.pdf' }, []).url, '/file.pdf');
  assert.equal(normalizeLink(base, { href: '/file.pdf' }, ['zip']).url, '/file.pdf');
});

test('filters existing and discovered scenarios while preserving allowed overrides', () => {
  const page = { url: '/page', label: 'Custom label', delay: 42 };
  const existing = [
    { url: '/old.PDF?download=1' }, { referenceUrl: 'https://example.org/old.zip' }, page
  ];
  const discovered = [{ url: '/', label: 'Homepage' }, { url: '/new.pdf' }, { url: '/page' }];
  assert.deepEqual(mergeScenarios(existing, discovered, ['pdf', '.zip']), [discovered[0], page]);
  assert.deepEqual(mergeScenarios(existing, [], []), existing);
});

test('config CLI saves defaults and uses existing exclusions before applying the discovery limit', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-discovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  const preloadPath = path.join(directory, 'browser.cjs');
  // Stub only browser I/O; exercise the actual config read, merge and write path.
  await fs.writeFile(preloadPath, `
    const puppeteerPath = ${JSON.stringify(require.resolve('puppeteer-core'))};
    require(puppeteerPath);
    require.cache[puppeteerPath].exports = { launch: async () => ({
      newPage: async () => ({
        goto: async () => {}, close: async () => {},
        $$eval: async () => [
          { href: '/file.pdf' }, { href: '/archive.zip' }, { href: '/page', text: 'Page' }
        ]
      }),
      close: async () => {}
    }) };
  `);
  const run = () => promisify(execFile)(process.execPath, [
    '--require', preloadPath, path.join(__dirname, '../scripts/config.js'),
    '--ref=https://example.org', '--links=https://example.org', '--limit=2'
  ], { env: { ...process.env, REG_SUIT_DIR: directory, REG_SUIT_CONFIG: configPath,
    GLOBAL_REG_SUIT_CONFIG: configPath, REG_SUIT_SCRIPT_DIR: path.join(__dirname, '..'),
    PUPPETEER_EXECUTABLE_PATH: process.execPath } });

  await run();
  const created = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(created.excludeExtensions, ['.pdf']);
  assert.deepEqual(created.scenarios.map(scenario => scenario.url), ['/', '/archive.zip']);

  await fs.writeFile(configPath, JSON.stringify({
    ...created, excludeExtensions: ['pdf', '.zip'],
    scenarios: [{ url: '/old.pdf' }, { url: '/saved', label: 'Saved', delay: 42 }]
  }));
  await run();
  const updated = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(updated.excludeExtensions, ['pdf', '.zip']);
  assert.deepEqual(updated.scenarios, [
    { url: '/', label: 'Homepage' }, { url: '/saved', label: 'Saved', delay: 42 },
    { url: '/page', label: 'Page' }
  ]);
  assert.equal(updated.referenceBaseURL, created.referenceBaseURL);
});

test('rejects Cookiebot placeholders before their fragments hide the token', () => {
  assert.equal(normalizeLink(base, {
    href: '[#DSR_FORM_URL#]', text: '[#DSR_FORM_URL_TEXT#]'
  }), null);
  assert.equal(normalizeLink(base, { href: '/[', text: 'Broken link' }), null);
  assert.equal(normalizeLink(base, { href: '/%5B', text: 'Broken link' }), null);
});

test('rejects raw and encoded template URLs and unresolved labels', () => {
  for (const href of ['/{{page}}', '/${page}', '/<%= page %>', '/%5B%23PAGE%23%5D']) {
    assert.equal(normalizeLink(base, { href }), null, href);
  }
  for (const field of ['text', 'title', 'ariaLabel']) {
    assert.equal(normalizeLink(base, { href: '/page', [field]: '[#LABEL#]' }), null);
  }
});

test('keeps valid internal links, queries, fragments and balanced brackets', () => {
  for (const [href, url] of [
    ['/services/#contact', '/services'],
    ['/search?filters[type]=news', '/search?filters[type]=news'],
    ['/docs/[section]', '/docs/[section]'],
    ['/news?text=%23update', '/news?text=%23update']
  ]) {
    assert.deepEqual(normalizeLink(base, { href, text: 'Useful page' }), { url, label: 'Useful page' });
  }
  for (const href of ['mailto:info@example.org', 'javascript:void(0)', 'https://elsewhere.org/page', '#menu']) {
    assert.equal(normalizeLink(base, { href }), null);
  }
});
