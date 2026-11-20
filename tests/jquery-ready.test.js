const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');
const wait = require('../scripts/hooks/wait-for-jquery-ready');
const { updateConfig } = require('../scripts/config-update');
const { buildImportedConfig } = require('../scripts/import');
const { withRetryTimeouts } = require('../scripts/retry-timeouts');
const template = require('../config-default.json');

// A local implementation of the public jQuery(document).ready(callback) contract:
// DOM readiness and application startup readiness deliberately happen separately.
function heldStartup({ release = true, open = false, image = false } = {}) {
  return `<style>body{margin:0;background:lime}nav{height:80px;background:red}</style><nav>Menu</nav><script>
    let releaseStartup;
    const startup = new Promise(resolve => releaseStartup = resolve);
    window.jQuery = function() { return { ready: callback => startup.then(() => setTimeout(callback, 0)) }; };
    jQuery.fn = { ready: function(){} };
    jQuery(document).ready(() => {
      ${open ? '' : "document.querySelector('nav').hidden = true;"}
      ${image ? "document.body.insertAdjacentHTML('beforeend', '<img data-src=\"/green.svg\" width=\"80\" height=\"80\">');" : ''}
      document.body.dataset.initialized = 'true';
    });
    window.releaseStartup = releaseStartup;
    ${release ? 'setTimeout(releaseStartup, 350);' : ''}
  </script>`;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-jquery-ready-'));
  const requests = new Map();
  const server = http.createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/green.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="lime"/></svg>');
    } else if (request.url === '/never' || request.url === '/controlled') response.end(heldStartup({ release: false }));
    else if (request.url === '/retry') response.end(heldStartup({ release: requests.get('/retry') > 1 }));
    else response.end(heldStartup({ open: request.url === '/open', image: request.url === '/image' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { browser, directory, requests, base: `http://127.0.0.1:${server.address().port}` };
}

async function pixel(page, png, x = 90, y = 70) {
  return page.evaluate(async ({ png, x, y }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data];
  }, { png: Buffer.from(png).toString('base64'), x, y });
}

test('waits beyond load for startup callbacks, captures their final UI, and does not close intentional menus', async t => {
  const { browser, base } = await fixture(t);
  const page = await browser.newPage();
  await page.setViewport({ width: 100, height: 100 });
  await page.goto(base + '/controlled', { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => document.readyState), 'complete');
  assert.deepEqual(await pixel(page, await page.screenshot()), [255, 0, 0, 255], 'load alone still shows the uninitialized menu');
  const waiting = wait(page);
  await page.evaluate(() => window.releaseStartup());
  await waiting;
  assert.equal(await page.evaluate(() => document.body.dataset.initialized), 'true');
  assert.deepEqual(await pixel(page, await page.screenshot()), [0, 255, 0, 255]);
  await page.goto(base + '/open', { waitUntil: 'load' });
  await wait(page);
  assert.equal(await page.evaluate(() => document.body.dataset.initialized), 'true');
  assert.deepEqual(await pixel(page, await page.screenshot()), [255, 0, 0, 255], 'intentional open menu must remain visible');
});

test('rechecks lazy images created by startup callbacks', async t => {
  const { browser, base, requests } = await fixture(t);
  const page = await browser.newPage();
  await page.setViewport({ width: 100, height: 100 });
  await page.goto(base + '/image', { waitUntil: 'load' });
  await wait(page);
  assert.equal(requests.get('/green.svg'), 1);
  assert.equal(await page.$eval('img', image => image.complete && image.naturalWidth === 80), true);
  assert.deepEqual(await pixel(page, await page.screenshot()), [0, 255, 0, 255]);
});

test('without the lazy-image hook in the project, startup image changes are not rechecked', async t => {
  const { browser, base, requests } = await fixture(t);
  const page = await browser.newPage();
  await page.goto(base + '/image', { waitUntil: 'load' });
  await wait(page, { loadsLazyImages: false });
  assert.equal(await page.$eval('img', image => image.getAttribute('data-src')), '/green.svg');
  assert.equal(requests.get('/green.svg'), undefined);
});

test('can disable the hook per scenario and pages without jQuery remain unchanged', async t => {
  const { browser, base } = await fixture(t);
  const page = await browser.newPage();
  await page.goto(base + '/never', { waitUntil: 'load' });
  await wait(page, { config: { defaults: { waitForJQueryReady: true } }, scenario: { waitForJQueryReady: false } });
  assert.equal(await page.$eval('nav', menu => menu.hidden), false);
  await page.goto('data:text/html,<nav>Visible navigation</nav><iframe hidden src="about:blank"></iframe>');
  await wait(page);
  assert.equal(await page.$eval('nav', menu => menu.hidden), false);
  await page.evaluate(() => { window.jQuery = { unrelated: true }; });
  await wait(page); // Do not mistake an unrelated global for the library.
});

test('timeouts fail without screenshots, allow bounded retries, and hook removal skips startup waiting', async t => {
  const { browser, base, directory, requests } = await fixture(t);
  const config = { core: { temporaryErrorRetries: 1 }, defaults: { waitUntil: 'load', fullPage: false, jqueryReadyTimeout: 600 },
    onReadyScript: ['hooks/wait-for-jquery-ready'] };
  const selection = { scenarios: [{ url: '/never' }], viewports: [{ label: 'phone', width: 100, height: 100 }] };
  await assert.rejects(captureScreenshots(browser, config, selection, directory, base, false, 'reference'), /Page startup did not finish[\s\S]*jQuery ready/);
  assert.equal(requests.get('/never'), 2);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(browser.browserContexts().length, 1);
  selection.scenarios[0].url = '/retry';
  await captureScreenshots(browser, config, selection, directory, base, false, 'reference');
  assert.equal(requests.get('/retry'), 2);
  assert.equal((await fs.readdir(directory)).length, 1);
  config.onReadyScript = [];
  selection.scenarios[0].url = '/never';
  await captureScreenshots(browser, config, selection, directory, base, false, 'reference');
  assert.equal(requests.get('/never'), 3);
  assert.equal((await fs.readdir(directory)).length, 2);
});

test('configuration defaults, disabling overrides, imports, and retry budgets retain their meanings', () => {
  assert.equal(template.defaults.waitForJQueryReady, true);
  assert(template.onReadyScript.indexOf('hooks/wait-for-jquery-ready') > template.onReadyScript.indexOf('hooks/load-lazy-images'));
  assert.equal(updateConfig({}, template).defaults.jqueryReadyTimeout, 30000);
  const updated = updateConfig({ defaults: { waitForJQueryReady: false, jqueryReadyTimeout: 123 }, onReadyScript: [] }, template);
  assert.equal(updated.defaults.waitForJQueryReady, false);
  assert.equal(updated.defaults.jqueryReadyTimeout, 123);
  assert(updated.onReadyScript.includes('hooks/wait-for-jquery-ready'));
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', waitForJQueryReady: false, jqueryReadyTimeout: 123 },
    { url: 'https://example.test/two', waitForJQueryReady: true, jqueryReadyTimeout: 456 }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].waitForJQueryReady, false);
  assert.equal(imported.scenarios[0].jqueryReadyTimeout, 123);
  assert.equal(withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: 2 }, defaults: { jqueryReadyTimeout: 100 } }, {}, 1).config.defaults.jqueryReadyTimeout, 200);
  assert.equal(withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: 2 } }, { jqueryReadyTimeout: 123 }, 1).scenario.jqueryReadyTimeout, 246);
  assert.throws(() => wait.resolveOptions({}, { waitForJQueryReady: 'false' }), /boolean/);
  for (const jqueryReadyTimeout of [0, -1, Infinity, '100']) assert.throws(() => wait.resolveOptions({}, { jqueryReadyTimeout }), /positive number/);
});

test('invalid startup settings are rejected before requests or output mutations', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.onReadyScript = ['hooks/wait-for-jquery-ready'];
  for (const settings of [{ waitForJQueryReady: 'false' }, { waitForJQueryReady: true, jqueryReadyTimeout: 0 }]) {
    Object.assign(f.config.defaults, settings);
    await f.save();
    const result = await f.run(['reference'], 1);
    assert.match(result.stderr, /waitForJQueryReady must be a boolean|jqueryReadyTimeout must be a positive number/);
    assert.deepEqual(f.requests, []);
    await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
  }
});
