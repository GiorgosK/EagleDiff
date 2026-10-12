const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');

test('capture retries transient stylesheet and image timeouts, but not broken resources', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-retries-'));
  const requests = new Map();
  const server = http.createServer((req, res) => {
    const count = (requests.get(req.url) || 0) + 1;
    requests.set(req.url, count);
    if (req.url === '/slow.css') {
      if (count === 1) return;
      res.setHeader('Content-Type', 'text/css'); res.end('h1{color:green}'); return;
    }
    if (req.url === '/slow.svg' || req.url === '/slow-warn.svg') {
      if (count === 1) return;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'); return;
    }
    if (req.url === '/missing.svg') { res.writeHead(404); res.end(); return; }
    if (req.url === '/outage') { res.writeHead(503); res.end('Unavailable'); return; }
    if (req.url === '/always.css') return;
    if (req.url === '/always.svg') return;
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/deferred-form' || req.url === '/absent-form') {
      res.end(req.url === '/deferred-form' && count > 1 ? '<button id="ready">Loaded</button>' : '<footer>Form has not loaded</footer>'); return;
    }
    if (req.url === '/stylesheet') res.end('<link rel="stylesheet" href="/slow.css"><script>window.ready=true</script><h1>Ready</h1>');
    else if (req.url === '/image') res.end('<img src="/slow.svg">');
    else if (req.url === '/warn-image') res.end('<img src="/slow-warn.svg">');
    else if (req.url === '/always-image') res.end('<img src="/always.svg">');
    else if (req.url === '/broken') res.end('<img src="/missing.svg">');
    else res.end('<link rel="stylesheet" href="/always.css"><script>window.ready=true</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = {
    core: { temporaryErrorRetries: 1 },
    defaults: { waitUntil: 'domcontentloaded', navigationTimeout: 1000, lazyImageTimeout: 300,
      fullPage: false, failOnResponseStatusCodes: [503] },
    onReadyScript: ['hooks/fail-on-response-status', 'hooks/wait-for-element', 'hooks/load-lazy-images'],
    viewports: [{ label: 'phone', width: 100, height: 100 }]
  };
  const capture = (url, overrides = {}) => captureScreenshots(browser, config, {
    scenarios: [{ url, ...overrides }], viewports: config.viewports
  }, directory, `http://127.0.0.1:${server.address().port}`, false, 'reference');

  await capture('/stylesheet');
  assert.equal(requests.get('/stylesheet'), 2);
  assert.equal(requests.get('/slow.css'), 2);
  await capture('/image');
  assert.equal(requests.get('/image'), 2);
  assert.equal(requests.get('/slow.svg'), 2);
  assert.equal((await fs.readdir(directory)).length, 2);
  await capture('/deferred-form', { readySelector: '#ready', readyTimeout: 1000, readyVisible: true });
  assert.equal(requests.get('/deferred-form'), 2);
  await assert.rejects(capture('/absent-form', { readySelector: '#ready', readyTimeout: 1000 }), /Required readySelector/);
  assert.equal(requests.get('/absent-form'), 2);
  assert.equal((await fs.readdir(directory)).length, 3);
  await capture('/warn-image', { imageFailurePolicy: 'warn' });
  assert.equal(requests.get('/warn-image'), 2, 'warning mode must retry unresolved images');
  assert.equal(requests.get('/slow-warn.svg'), 2);
  assert.equal((await fs.readdir(directory)).length, 4);
  await assert.rejects(capture('/always-image', { imageFailurePolicy: 'warn' }),
    /Cannot load image before capture:[\s\S]*Timed out after 300ms/);
  assert.equal(requests.get('/always-image'), 2);
  assert.equal((await fs.readdir(directory)).length, 4, 'exhausted image retries must not save a capture');
  await assert.rejects(capture('/broken'), /Cannot load image before capture/);
  assert.equal(requests.get('/broken'), 1);
  await assert.rejects(capture('/outage'), /Blocked response status 503/);
  assert.equal(requests.get('/outage'), 1);
  await assert.rejects(capture('/always'), /Navigation timeout/);
  assert.equal(requests.get('/always'), 2);
  assert.equal((await fs.readdir(directory)).length, 4);
});
