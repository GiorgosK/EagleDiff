const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const stable = require('../scripts/hooks/wait-for-stable-content');
const { captureScreenshots, buildBrowserLaunchOptions } = require('../scripts/run');
const { withRetryTimeouts } = require('../scripts/retry-timeouts');

const settings = { triggerSelectors: ['script#loader'], selectors: ['.widget', '#loader'], timeout: 800, settleDelayMs: 50 };

test('timeouts distinguish missing targets, hidden loader scripts and visible changing content', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  for (const [html, selectors, phase, detail] of [
    ['<script id="loader"></script>', ['.widget'], /matching content to appear/, /\.widget: no matches/],
    ['<script id="loader"></script>', ['.widget', '#loader'], /visible content to settle/, /SCRIPT#loader: hidden, 0x0/],
    ['<script id="loader"></script><div class="widget" style="width:100px;height:60px">Loading</div><script>setInterval(()=>document.querySelector(".widget").append("."),30)</script>', ['.widget'], /visible content to settle/, /DIV: visible/]
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto('data:text/html,' + encodeURIComponent(html));
      await assert.rejects(stable(page, { scenario: { waitForStableContent: { ...settings, selectors, timeout: 350 } }, config: {} }), error => {
        assert.equal(error.code, 'EAGLEDIFF_STABLE_CONTENT_TIMEOUT');
        assert.equal(error.cause.name, 'TimeoutError');
        assert.match(error.message, phase); assert.match(error.message, detail);
        return true;
      });
    } finally { await page.close(); }
  }
});

test('a missing widget retries in a fresh context and only a complete widget is captured; zero and retry limits remain effective', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-stable-content-'));
  const requests = new Map();
  const server = http.createServer((request, response) => {
    const count = (requests.get(request.url) || 0) + 1; requests.set(request.url, count);
    response.setHeader('Content-Type', 'text/html');
    response.end('<style>body{margin:0;background:red}.widget{width:100px;height:100px;background:lime}</style><script id="loader"></script>' +
      (request.url === '/retry' && count > 1 ? '<div class="widget">Ready</div>' : ''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = { core: { workers: 15, temporaryErrorRetries: 1 },
    defaults: { fullPage: false, waitUntil: 'domcontentloaded', waitForStableContent: settings },
    onReadyScript: ['hooks/wait-for-stable-content'] };
  const capture = url => captureScreenshots(browser, config, { scenarios: [{ url }], viewports: [{ label: 'phone', width: 100, height: 100 }] },
    directory, `http://127.0.0.1:${server.address().port}`, false, 'reference');
  await capture('/retry');
  assert.equal(requests.get('/retry'), 2);
  const files = await fs.readdir(directory); assert.equal(files.length, 1);
  const page = await browser.newPage();
  try {
    const png = (await fs.readFile(path.join(directory, files[0]))).toString('base64');
    const color = await page.evaluate(async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(50, 50, 1, 1).data];
    }, png);
    assert.deepEqual(color, [0, 255, 0, 255]);
  } finally { await page.close(); }
  await assert.rejects(capture('/always'), /Content did not become stable/);
  assert.equal(requests.get('/always'), 2);
  config.core.temporaryErrorRetries = 0;
  await assert.rejects(capture('/disabled'), /Content did not become stable/);
  assert.equal(requests.get('/disabled'), 1);
  assert.deepEqual(await fs.readdir(directory), files, 'failed captures do not save incomplete screenshots');
  assert.equal(browser.browserContexts().length, 1);
  assert.equal(config.core.workers, 15);
});

test('failed stable-content reference runs preserve existing baselines', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.scenarios = [{ url: '/one' }];
  f.config.defaults.waitForStableContent = settings;
  f.config.onReadyScript = ['hooks/wait-for-stable-content']; await f.save(); await f.run(['reference']);
  const file = path.join(f.directory, '.reg/reference', (await f.files())[0]);
  const baseline = await fs.readFile(file);
  f.pages['/one'] = '<script id="loader"></script>';
  f.config.core.temporaryErrorRetries = 1; await f.save();
  const result = await f.run(['reference'], 1);
  assert.match(result.stderr, /retrying 1\/1/);
  assert.match(require('./helpers/capture-log')(result.stderr), /SCRIPT#loader: hidden/);
  assert.deepEqual(await fs.readFile(file), baseline);
});

test('legacy and nested stable-content retry budgets scale without changing settling duration', () => {
  const config = { core: { temporaryErrorRetryTimeoutMultiplier: 2 }, defaults: {
    waitForTimeout: 100, waitForSettleDelayMs: 25, waitForStableContent: { timeout: 200, settleDelayMs: 50 }
  } };
  const scenario = { waitForTimeout: 300, waitForStableContent: { timeout: 400 } };
  const result = withRetryTimeouts(config, scenario, 1);
  assert.equal(result.config.defaults.waitForTimeout, 200);
  assert.equal(result.config.defaults.waitForStableContent.timeout, 400);
  assert.equal(result.config.defaults.waitForSettleDelayMs, 25);
  assert.equal(result.config.defaults.waitForStableContent.settleDelayMs, 50);
  assert.equal(result.scenario.waitForTimeout, 600);
  assert.equal(result.scenario.waitForStableContent.timeout, 800);
});

test('browser and selector errors are not disguised as stable-content timeouts', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent('<script id="loader"></script>');
  await assert.rejects(stable(page, { config: {}, scenario: { waitForStableContent: { ...settings, selectors: ['['] } } }), error => {
    assert.notEqual(error.code, 'EAGLEDIFF_STABLE_CONTENT_TIMEOUT'); assert.match(error.message, /selector/); return true;
  });
  await page.close();
  await assert.rejects(stable(page, { config: {}, scenario: { waitForStableContent: settings } }), error => {
    assert.notEqual(error.code, 'EAGLEDIFF_STABLE_CONTENT_TIMEOUT'); return true;
  });
});
