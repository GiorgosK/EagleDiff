const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { applyCookies } = require('../scripts/cookies');
const { buildImportedConfig } = require('../scripts/import');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');
const template = require('../config-default.json');

test('Backstop import resolves shared and scenario cookie files relative to the manifest', () => {
  const imported = buildImportedConfig(template, template, {
    scenarios: [
      { label: 'One', url: 'https://example.test/one', cookiePath: 'engine/cookies.json' },
      { label: 'Two', url: 'https://example.test/two', cookiePath: 'engine/cookies.json' }
    ]
  }, '/project/backstop/backstop.json', '/project/eaglediff/config.json');
  assert.equal(imported.defaults.cookiePath, '../backstop/engine/cookies.json');
  assert(imported.scenarios.every(scenario => !Object.hasOwn(scenario, 'cookiePath')));
  const perScenario = buildImportedConfig(template, template, {
    scenarios: [
      { url: 'https://example.test/one', cookiePath: 'one.json' },
      { url: 'https://example.test/two', cookiePath: 'two.json' }
    ]
  }, '/project/backstop/backstop.json', '/project/eaglediff/config.json');
  assert.deepEqual(perScenario.scenarios.map(s => s.cookiePath), ['../backstop/one.json', '../backstop/two.json']);
  const disabled = buildImportedConfig({ ...template, defaults: {
    ...template.defaults, cookiePath: 'saved.json', cookies: [{ name: 'shared', value: 'yes' }]
  } }, template, {
    cookiePath: 'cookies.json', scenarios: [
      { url: 'https://example.test/one' },
      { url: 'https://example.test/two', cookiePath: null, cookies: [] }
    ]
  }, '/project/backstop/backstop.json', '/project/eaglediff/config.json');
  assert.equal(disabled.scenarios[0].cookiePath, '../backstop/cookies.json');
  assert.equal(disabled.scenarios[1].cookiePath, null);
  assert.deepEqual(disabled.scenarios[1].cookies, []);
});

test('cookies keep scope and expiry unless explicitly changed, and invalid files fail clearly', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-cookies-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const warnings = [];
  const calls = [];
  const context = { setCookie: async (...cookies) => calls.push(cookies) };
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(path.join(directory, 'cookies.json'), JSON.stringify([
    { name: 'consent', value: 'yes', domain: 'old.test', expires: 1, path: '/' },
    { name: 'active', value: 'yes', domain: 'old.test' }
  ]));
  await applyCookies(context, 'https://current.test/page', {}, { cookiePath: 'cookies.json' }, configPath,
    (...warning) => warnings.push(warning));
  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0].domain, 'old.test');
  assert.deepEqual(warnings.map(w => w[0]), ['expired-cookies', 'cookie-domain']);
  await applyCookies(context, 'https://current.test/page', {}, {
    cookiePath: 'cookies.json', cookieDomain: 'current', cookieExpiry: 'session'
  }, configPath, () => {});
  assert(calls[1].every(cookie => cookie.domain === 'current.test' && cookie.expires === undefined));
  await applyCookies(context, 'https://current.test/', { cookies: [], cookiePath: null }, {
    cookiePath: 'cookies.json', cookies: [{ name: 'default', value: 'yes' }]
  }, configPath, () => {});
  assert.equal(calls.length, 2);
  await assert.rejects(applyCookies(context, 'https://current.test/', {}, {
    cookiePath: 'missing.json'
  }, configPath, () => {}), /Cannot load cookiePath.*missing.json/);
});

test('capture sends cookies on the first request and isolates each scenario', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-cookie-capture-'));
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.end(); return; }
    seen.push({ url: req.url, cookie: req.headers.cookie || '' });
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Set-Cookie', 'leak=previous; Path=/');
    res.end('<h1>Cookie fixture</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = {
    defaults: { fullPage: false, waitUntil: 'domcontentloaded', cookies: [{ name: 'consent', value: 'yes' }] },
    viewports: [{ label: 'phone', width: 100, height: 100 }],
    scenarios: [{ url: '/one' }, { url: '/two', cookies: [] }]
  };
  await captureScreenshots(browser, config, config, directory,
    `http://127.0.0.1:${server.address().port}`, false, 'reference');
  assert.deepEqual(seen, [{ url: '/one', cookie: 'consent=yes' }, { url: '/two', cookie: '' }]);
});
