const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');
const wait = require('../scripts/hooks/wait-for-browser-verification');

const settings = overrides => ({ config: {}, scenario: { browserVerification: {
  challengeSelectors: '#verification-panel', errorSelectors: '#verification-error',
  timeout: 2000, settleDelayMs: 200, ...overrides
} } });

async function fixture(t) {
  const requests = new Map();
  const server = http.createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/retained.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('setTimeout(()=>{document.querySelector("#verification-panel").remove();document.body.insertAdjacentHTML("beforeend","<main id=app-ready>Ready</main>")},100);');
    } else if (request.url === '/wrapper') {
      response.end('<div id="verification-panel">Checking</div><script src="/retained.js"></script>');
    } else if (request.url === '/transient') {
      response.end(`<div id="verification-panel">Checking</div><script>
        setTimeout(()=>document.querySelector('#verification-panel').remove(),80);
        setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<div id="verification-panel">Checking again</div>'),140);
        setTimeout(()=>{document.querySelector('#verification-panel').remove();window.verified=true},260);
      </script>`);
    } else if (request.url === '/redirect') {
      response.end('<div id="verification-panel">Checking</div><script>setTimeout(()=>location="/intermediate",100)</script>');
    } else if (request.url === '/intermediate') {
      response.end('<title>Redirecting</title><script>setTimeout(()=>location="/ready",100)</script>');
    } else if (request.url === '/ready') {
      response.end('<style>body{margin:0;background:lime}</style><main id="app-ready">Ready</main>');
    } else response.end('<div id="verification-panel">Still checking</div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-verification-state-'));
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { browser, page: await browser.newPage(), base: `http://127.0.0.1:${server.address().port}`, requests, directory };
}

test('removing the verification structure completes the wait even when its script stays loaded', async t => {
  const { page, base } = await fixture(t);
  await page.goto(base + '/wrapper', { waitUntil: 'domcontentloaded' });
  const listeners = page.listenerCount('framenavigated');
  await wait(page, settings());
  assert(await page.$('#app-ready'));
  assert(await page.$('script[src="/retained.js"]'));
  assert.equal(await page.$('#verification-panel'), null);
  assert.equal(page.listenerCount('framenavigated'), listeners);
});

test('a transiently missing structure does not finish verification early', async t => {
  const { page, base } = await fixture(t);
  await page.goto(base + '/transient', { waitUntil: 'domcontentloaded' });
  await wait(page, settings());
  assert.equal(await page.evaluate(() => window.verified), true);
});

test('a replaced verification screen clears even when its script marker remains', async t => {
  const { page } = await fixture(t);
  await page.setContent('<script data-verification></script><section id="screen">Checking</section>');
  const listeners = page.listenerCount('framenavigated');
  const waiting = wait(page, settings({ challengeSelectors: 'script[data-verification]' }));
  await page.waitForFunction(() => document.querySelector('#screen'));
  // Leave enough time for the first verification observation before replacing its screen.
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.evaluate(() => {
    document.querySelector('#screen').remove();
    document.body.insertAdjacentHTML('beforeend', '<main id="app-ready">Actual page</main>');
  });
  await waiting;
  assert(await page.$('#app-ready'));
  assert(await page.$('script[data-verification]'));
  assert.equal(page.listenerCount('framenavigated'), listeners);
});

test('changing verification text does not count as replacing the screen', async t => {
  const { page } = await fixture(t);
  await page.setContent('<script data-verification></script><section id="screen">Checking</section>');
  await page.evaluate(() => {
    window.spinner = setInterval(() => document.querySelector('#screen').textContent = String(Date.now()), 20);
  });
  await assert.rejects(wait(page, settings({ challengeSelectors: 'script[data-verification]', timeout: 300, settleDelayMs: 0 })), /did not complete/);
});

test('empty replacements and replacement challenge containers still fail', async t => {
  const { page } = await fixture(t);
  for (const replacement of ['', '<section class="challenge">Still checking</section>']) {
    await page.setContent('<script data-verification></script><section class="challenge">Checking</section>');
    const rejected = assert.rejects(wait(page, settings({
      challengeSelectors: 'script[data-verification], .challenge', timeout: 400, settleDelayMs: 0
    })), /did not complete/);
    await new Promise(resolve => setTimeout(resolve, 150));
    await page.evaluate(html => {
      document.querySelector('.challenge').remove();
      document.body.insertAdjacentHTML('beforeend', html);
    }, replacement);
    await rejected;
  }
});

test('absence must settle across redirects before a screenshot can be saved', async t => {
  const { browser, page, base, directory } = await fixture(t);
  const config = { defaults: { waitUntil: 'domcontentloaded', fullPage: false,
    browserVerification: settings().scenario.browserVerification }, onReadyScript: ['hooks/wait-for-browser-verification'] };
  await captureScreenshots(browser, config, { scenarios: [{ url: '/redirect' }],
    viewports: [{ label: 'phone', width: 100, height: 100 }] }, directory, base, false, 'reference');
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const png = await fs.readFile(path.join(directory, files[0]));
  const color = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(90, 90, 1, 1).data];
  }, 'data:image/png;base64,' + png.toString('base64'));
  assert.deepEqual(color, [0, 255, 0, 255]);
  assert.equal(browser.browserContexts().length, 1);
});

test('an initial document stuck loading produces actionable diagnostics instead of a generic timeout', async t => {
  const { page } = await fixture(t);
  await page.evaluate(() => { document.open(); document.write('<title>Loading fixture</title><main>Partial content</main>'); });
  await assert.rejects(wait(page, settings({ timeout: 150, settleDelayMs: 0 })), error => {
    assert.equal(error.code, 'EAGLEDIFF_BROWSER_VERIFICATION_TIMEOUT');
    assert.match(error.message, /^Document did not become ready/);
    assert.match(error.message, /waiting for the initial document/);
    assert.match(error.message, /Document: loading/);
    assert.match(error.message, /Verification observed: false/);
    return true;
  });
});

test('initial loading and verification share one timeout budget', async t => {
  const { page } = await fixture(t);
  await page.evaluate(() => {
    document.open(); document.write('<div id="verification-panel">Checking</div>');
    setTimeout(() => document.close(), 100);
    setTimeout(() => document.querySelector('#verification-panel')?.remove(), 300);
  });
  await assert.rejects(wait(page, settings({ timeout: 200, settleDelayMs: 0 })), /did not complete within 200ms/);
});

test('unfinished verification saves nothing and does not amplify traffic through automatic retries', async t => {
  const { browser, base, directory, requests } = await fixture(t);
  const config = { core: { temporaryErrorRetries: 2 }, defaults: { waitUntil: 'domcontentloaded',
    browserVerification: settings({ timeout: 150 }).scenario.browserVerification },
    onReadyScript: ['hooks/wait-for-browser-verification'] };
  await assert.rejects(captureScreenshots(browser, config, { scenarios: [{ url: '/never' }],
    viewports: [{ label: 'phone', width: 100, height: 100 }] }, directory, base, false, 'reference'), /Verification observed: true; remaining markers: 1/);
  assert.equal(requests.get('/never'), 1);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(browser.browserContexts().length, 1);
});

test('browser failures propagate, invalid selectors remain errors and listeners are removed', async t => {
  const { page, browser, base } = await fixture(t);
  await page.goto(base + '/never');
  const listeners = page.listenerCount('framenavigated');
  await assert.rejects(wait(page, settings({ challengeSelectors: '[' })), /querySelectorAll/);
  assert.equal(page.listenerCount('framenavigated'), listeners);
  const rejected = assert.rejects(wait(page, settings()), /closed|detached|Connection/i);
  await browser.close();
  await rejected;
  assert.equal(page.listenerCount('framenavigated'), listeners);
});

test('config updates and imports preserve structure selectors, zero settling and disabling values', () => {
  const template = require('../config-default.json');
  const { updateConfig } = require('../scripts/config-update');
  const { buildImportedConfig } = require('../scripts/import');
  const options = { challengeSelectors: ['#verification-panel'], settleDelayMs: 0, timeout: 123 };
  const updated = updateConfig({ defaults: { browserVerification: options } }, template);
  assert.equal(updated.defaults.browserVerification.settleDelayMs, 0);
  assert.deepEqual(updated.defaults.browserVerification.challengeSelectors, ['#verification-panel']);
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', browserVerification: options },
    { url: 'https://example.test/two', browserVerification: { challengeSelectors: [] } }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.deepEqual(imported.scenarios[0].browserVerification, options);
  assert.deepEqual(imported.scenarios[1].browserVerification.challengeSelectors, []);
  assert.throws(() => wait.resolveOptions({}, { browserVerification: { challengeSelectors: '#verify', settleDelayMs: -1 } }), /non-negative/);
});

test('invalid verification budgets fail before requests or capture output', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.defaults.browserVerification = { challengeSelectors: '#verify', timeout: 0 };
  await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /browserVerification.timeout/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
});
