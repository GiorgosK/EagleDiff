const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeLink, mergeScenarios } = require('../scripts/config');
const template = require('../config-default.json');

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-discovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  const preloadPath = path.join(directory, 'browser.cjs');
  // Stub only browser I/O; exercise the actual config read, merge and write path.
  await fs.writeFile(preloadPath, `
    const puppeteerPath = ${JSON.stringify(require.resolve('puppeteer-core'))};
    require(puppeteerPath);
    require.cache[puppeteerPath].exports = { launch: async () => ({
      createBrowserContext: async () => ({
        newPage: async () => ({
          goto: async () => {}, close: async () => {},
          on: () => {}, off: () => {}, evaluate: async () => null,
          url: () => 'https://example.org',
          waitForFunction: async () => ({ dispose: async () => {} }),
          $$eval: async () => ({ pageUrl: 'https://example.org', links: [
            { href: '/file.pdf' }, { href: '/archive.zip' }, { href: '/page', text: 'Page' }
          ] })
        }),
        close: async () => {}
      }),
      close: async () => {}
    }) };
  `);
  const run = () => promisify(execFile)(process.execPath, [
    '--require', preloadPath, path.join(__dirname, '../scripts/config.js'),
    '--ref=https://example.org', '--links=https://example.org', '--limit=2'
  ], { env: { ...process.env, EAGLEDIFF_DEFAULTS: 'none', EAGLEDIFF_DIR: directory, EAGLEDIFF_CONFIG: configPath,
    GLOBAL_EAGLEDIFF_CONFIG: configPath, EAGLEDIFF_SCRIPT_DIR: path.join(__dirname, '..'),
    PUPPETEER_EXECUTABLE_PATH: process.execPath } });

  await run();
  const created = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(created.excludeExtensions, template.excludeExtensions);
  assert.deepEqual(created.scenarios.map(scenario => scenario.url), ['/', '/page']);

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

test('CLI discovers 25 pages by default in the current directory and keeps explicit limit/directory options', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.pages['/'] = Array.from({ length: 35 }, (_, index) => `<a href="/page-${index}">Page ${index}</a>`).join('');
  const project = path.join(fixture.directory, 'project');
  await fs.mkdir(project);
  const configPath = path.join(project, 'config.json');
  const run = args => promisify(execFile)(process.execPath, [path.join(__dirname, '../bin/eaglediff.js'), 'config', ...args], {
    cwd: project, timeout: 15000,
    env: { ...process.env, EAGLEDIFF_DEFAULTS: 'none', INIT_CWD: '', EAGLEDIFF_DIR: '', EAGLEDIFF_PROJECT_DIR: '', EAGLEDIFF_ROOT: '', EAGLEDIFF_CONFIG: '', GLOBAL_EAGLEDIFF_CONFIG: '', EAGLEDIFF_SCRIPT_DIR: '', EAGLEDIFF_HELPER_DIR: '', npm_config_config: '', npm_config_limit: '', npm_config_test: '', npm_config_testurl: '', npm_node_execpath: process.execPath }
  });
  await run(['--ref=' + fixture.baseURL]);
  const created = JSON.parse(await fs.readFile(configPath));
  assert.equal(created.scenarios.length, 25);
  assert.equal(created.defaults.readySelector, '');
  assert.equal(created.scenarios[0].url, '/');
  assert.equal(created.scenarios[24].url, '/page-23');
  assert.equal(created.referenceBaseURL, fixture.baseURL);
  assert.equal(created.testBaseURL, fixture.baseURL);
  await assert.rejects(fs.access(path.join(project, 'tests/eaglediff')), { code: 'ENOENT' });

  await fs.unlink(configPath);
  await run(['--', '--ref=' + fixture.baseURL, '--limit=4']);
  const saved = await fs.readFile(configPath, 'utf8');
  assert.equal(JSON.parse(saved).scenarios.length, 4);
  await run(['--ref=' + fixture.baseURL, '--limit=3', '--dir', 'custom']);
  const custom = JSON.parse(await fs.readFile(path.join(project, 'custom/config.json')));
  assert.equal(custom.scenarios.length, 3);
  assert.equal(await fs.readFile(configPath, 'utf8'), saved);
});

test('discovery recovers a destroyed execution context and resolves links from the redirected page', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.pages['/'] = '<a href="/stale">Old document</a>';
  f.pages['/language/'] = '<a href="child">Final page</a><a href="/guide">Guide</a>';
  const preload = path.join(f.directory, 'navigation.cjs');
  await fs.writeFile(preload, `
    const puppeteerPath = ${JSON.stringify(require.resolve('puppeteer-core'))};
    const puppeteer = require(puppeteerPath);
    const launch = puppeteer.launch.bind(puppeteer);
    require.cache[puppeteerPath].exports = { ...puppeteer, launch: async (...args) => {
      const browser = await launch(...args);
      const createContext = browser.createBrowserContext.bind(browser);
      browser.createBrowserContext = async () => {
        const context = await createContext();
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          const evaluate = page.evaluate.bind(page);
          let interrupted = false;
          page.evaluate = async (...args) => {
            require('node:fs').appendFileSync(__dirname + '/inspection-attempts.txt', 'x');
            if (process.env.EAGLEDIFF_TEST_NAVIGATION_MODE === 'unexpected') throw new Error('Unexpected discovery failure');
            if (!interrupted || process.env.EAGLEDIFF_TEST_NAVIGATION_MODE === 'repeat') {
              interrupted = true;
              return evaluate(async () => {
                location.replace('/language/');
                await new Promise(() => {});
              });
            }
            return evaluate(...args);
          };
          return page;
        };
        return context;
      };
      return browser;
    } };
  `);
  const configPath = path.join(f.directory, 'config.json');
  await fs.unlink(configPath);
  const run = mode => promisify(execFile)(process.execPath, [
    '--require', preload, path.join(__dirname, '../scripts/config.js'), '--ref=' + f.baseURL
  ], { timeout: 15000, env: { ...process.env, EAGLEDIFF_DEFAULTS: 'none', EAGLEDIFF_DIR: f.directory,
    EAGLEDIFF_CONFIG: configPath, GLOBAL_EAGLEDIFF_CONFIG: configPath,
    EAGLEDIFF_SCRIPT_DIR: path.join(__dirname, '..'), EAGLEDIFF_TEST_NAVIGATION_MODE: mode } });
  const result = await run('once');
  const config = JSON.parse(await fs.readFile(configPath));
  assert.deepEqual(config.scenarios.map(scenario => scenario.url), ['/', '/language/child', '/guide'], JSON.stringify({output:result.stdout,requests:f.requests}));
  assert.match(result.stdout, /3 discovered scenarios/);
  assert.equal(config.referenceBaseURL, f.baseURL);
  assert(f.requests.includes('/language/'));
  const saved = await fs.readFile(configPath);
  const gitignore = await fs.readFile(path.join(f.directory, '.gitignore'));
  for (const [mode, message] of [['repeat', /interrupted by repeated navigation/], ['unexpected', /Unexpected discovery failure/]]) {
    f.requests.length = 0;
    await fs.rm(path.join(f.directory, 'inspection-attempts.txt'));
    await assert.rejects(run(mode), error => message.test(error.stderr));
    assert.deepEqual(await fs.readFile(configPath), saved);
    assert.deepEqual(await fs.readFile(path.join(f.directory, '.gitignore')), gitignore);
    assert.equal((await fs.readFile(path.join(f.directory, 'inspection-attempts.txt'), 'utf8')).length,
      mode === 'repeat' ? 3 : 1, 'Only navigation-context errors retry, up to three inspections');
  }
});
