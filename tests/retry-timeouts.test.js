const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { withRetryTimeouts } = require('../scripts/retry-timeouts');
const { captureScreenshots, buildBrowserLaunchOptions } = require('../scripts/run');

test('retry budgets preserve the original configuration, worker count, delays and disabled timeouts', () => {
  const config = {
    core: { workers: 10, temporaryErrorRetryTimeoutMultiplier: 2, protocolTimeout: 300000 },
    defaults: { navigationTimeout: 60000, readyTimeout: 60000, lazyImageTimeout: 30000,
      fontTimeout: 60000, iframeTimeout: 30000, scrollTimeout: 30000, waitUntilGoneTimeout: 10000,
      networkIdleTimeout: 5000, delay: 500, requiredFonts: ['400 16px Inter'],
      browserVerification: { timeout: 30000, challengeSelectors: ['.challenge'] },
      waitForStableContent: { timeout: 15000, settleDelayMs: 750 } }
  };
  const scenario = { url: '/', readySelector: '', readyTimeout: 100, navigationTimeout: 0, delay: 10,
    browserVerification: null, waitForStableContent: { timeout: 200, selectors: ['.footer'] } };
  const original = structuredClone({ config, scenario });
  const result = withRetryTimeouts(config, scenario, 2);
  assert.equal(result.config.defaults.navigationTimeout, 240000);
  assert.equal(result.config.defaults.lazyImageTimeout, 120000);
  assert.equal(result.config.defaults.readyTimeout, 240000);
  assert.equal(result.config.defaults.fontTimeout, 240000);
  assert.equal(result.config.defaults.iframeTimeout, 120000);
  assert.equal(result.config.defaults.scrollTimeout, 120000);
  assert.equal(result.config.defaults.waitUntilGoneTimeout, 40000);
  assert.equal(result.config.defaults.networkIdleTimeout, 20000);
  assert.equal(result.config.defaults.browserVerification.timeout, 120000);
  assert.equal(result.config.defaults.waitForStableContent.timeout, 60000);
  assert.equal(result.config.defaults.waitForStableContent.settleDelayMs, 750);
  assert.equal(result.scenario.readyTimeout, 400);
  assert.equal(result.scenario.readySelector, '');
  assert.equal(result.scenario.navigationTimeout, 0);
  assert.equal(result.scenario.waitForStableContent.timeout, 800);
  assert.equal(result.scenario.browserVerification, null);
  assert.deepEqual(result.config.core, config.core);
  assert.equal(result.config.defaults.delay, 500);
  assert.equal(result.scenario.delay, 10);
  assert.deepEqual({ config, scenario }, original);
  assert.equal(withRetryTimeouts(config, scenario, 0).config, config);
  assert.equal(withRetryTimeouts({ defaults: config.defaults }, scenario, 2).scenario, scenario);
  for (const value of [0, -1, NaN, Infinity, '2']) {
    assert.throws(() => withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: value } }, {}, 0), /at least 1/);
  }
  assert.throws(() => withRetryTimeouts(config, { readyTimeout: 2147483647 }, 1), /timer range/);
});

test('a slow image still completes after both retries were spent on earlier readiness failures', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-retry-budget-'));
  const requests = new Map();
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('.svg')) {
      setTimeout(() => {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
      }, 500);
      return;
    }
    const count = (requests.get(req.url) || 0) + 1;
    requests.set(req.url, count);
    res.setHeader('Content-Type', 'text/html');
    res.end(count < 3 ? '<p>Newsletter is delayed</p>' :
      `<button id="ready">Newsletter</button><img data-src="${req.url}.svg">`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = {
    core: { workers: 10, temporaryErrorRetries: 2, temporaryErrorRetryTimeoutMultiplier: 1 },
    defaults: { waitUntil: 'domcontentloaded', readySelector: '#ready', readyTimeout: 250,
      lazyImageTimeout: 250, imageFailurePolicy: 'warn', fullPage: false },
    onReadyScript: ['hooks/wait-for-element', 'hooks/load-lazy-images'],
    viewports: [{ label: 'phone', width: 320, height: 480 }]
  };
  const capture = url => captureScreenshots(browser, config,
    { scenarios: [{ url }], viewports: config.viewports }, directory,
    `http://127.0.0.1:${server.address().port}`, false, 'reference');
  await assert.rejects(capture('/fixed'), /Cannot load image before capture:[\s\S]*Timed out after 250ms/);
  assert.equal(requests.get('/fixed'), 3);
  assert.equal((await fs.readdir(directory)).length, 0);
  config.core.temporaryErrorRetryTimeoutMultiplier = 2;
  await capture('/adaptive');
  assert.equal(requests.get('/adaptive'), 3);
  assert.equal((await fs.readdir(directory)).length, 1);
  assert.equal(config.core.workers, 10);
  assert.equal(config.defaults.lazyImageTimeout, 250);
});
