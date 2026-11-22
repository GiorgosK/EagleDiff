const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');
const track = require('../scripts/image-request-diagnostics');

test('capture failures identify HTTP errors, invalid image responses, and aborted image requests', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-image-details-'));
  const requests = new Map();
  const server = http.createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    if (request.url === '/missing.webp') { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('Missing image'); }
    else if (request.url === '/invalid.webp') { response.writeHead(200, { 'Content-Type': 'image/webp' }); response.end('Invalid image bytes'); }
    else if (request.url === '/aborted.webp') request.socket.destroy();
    else if (request.url === '/redirect.webp') { response.writeHead(302, { Location: '/missing.webp' }); response.end(); }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(`<img src="${request.url.slice(1)}.webp">`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = { defaults: { waitUntil: 'load', fullPage: false },
    onReadyScript: ['hooks/load-lazy-images'], core: { temporaryErrorRetries: 1 } };
  for (const [url, detail] of [
    ['/missing', /Image response: HTTP 404 \(text\/html\)/],
    ['/invalid', /Image response: HTTP 200 \(image\/webp\)/],
    ['/redirect', /Image response: HTTP 404 \(text\/html\)/],
    ['/aborted', /Image network error: net::ERR_/]
  ]) {
    await assert.rejects(captureScreenshots(browser, config,
      { scenarios: [{ url }], viewports: [{ label: 'phone', width: 320, height: 480 }] },
      directory, `http://127.0.0.1:${server.address().port}`, false, 'test'), error => {
      assert.match(error.message, /Hook: hooks\/load-lazy-images/);
      assert.match(error.message, /Cannot load image before capture/);
      assert.match(error.message, detail);
      assert(error.cause, 'original capture failure is preserved');
      return true;
    });
    assert.equal(requests.get(url), 1, 'broken images must not retry');
    assert.equal(browser.browserContexts().length, 1, 'failed captures close their contexts');
  }
  assert.deepEqual(await fs.readdir(directory), [], 'failed captures must not save screenshots');
});

test('disposing diagnostics removes its page listeners', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  const counts = [page.listenerCount('response'), page.listenerCount('requestfailed')];
  const diagnostics = track(page);
  diagnostics.dispose();
  assert.deepEqual([page.listenerCount('response'), page.listenerCount('requestfailed')], counts);
  assert.equal(diagnostics.explain(new Error('unrelated error')), '');
});

test('image network failures retry in fresh contexts, respect zero, and stop at the limit', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-image-network-'));
  const requests = new Map();
  const server = http.createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    if (request.url.endsWith('.svg')) {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<img src="${request.url}.svg">`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  // Chromium emits a real requestfailed event with ERR_CONNECTION_RESET.
  const hook = path.join(directory, 'interrupt-image.js');
  await fs.writeFile(hook, `const failures = new Set();
    module.exports = async page => {
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = request.url();
        if (request.resourceType() === 'image' && (url.includes('always') || !failures.has(url))) {
          failures.add(url); request.abort('connectionreset');
        } else request.continue();
      });
    };`);
  const config = { defaults: { waitUntil: 'load', fullPage: false },
    onBeforeScript: [hook], onReadyScript: ['hooks/load-lazy-images'] };
  const capture = url => captureScreenshots(browser, config,
    { scenarios: [{ url }], viewports: [{ label: 'phone', width: 100, height: 100 }] },
    path.join(directory, 'captures'), `http://127.0.0.1:${server.address().port}`, false, 'reference');
  await fs.mkdir(path.join(directory, 'captures'));
  await capture('/recover'); // Missing setting uses the default of one retry.
  assert.equal(requests.get('/recover'), 2);
  const captures = await fs.readdir(path.join(directory, 'captures'));
  assert.equal(captures.length, 1);
  const png = await fs.readFile(path.join(directory, 'captures', captures[0]));
  assert.equal(png.readUInt32BE(16), 100);
  assert.equal(png.readUInt32BE(20), 100);
  config.core = { temporaryErrorRetries: 0 };
  await assert.rejects(capture('/disabled'), /Image network error: net::ERR_CONNECTION_RESET/);
  assert.equal(requests.get('/disabled'), 1);
  config.core.temporaryErrorRetries = 1;
  await assert.rejects(capture('/always'), /Image network error: net::ERR_CONNECTION_RESET/);
  assert.equal(requests.get('/always'), 2);
  assert.deepEqual(await fs.readdir(path.join(directory, 'captures')), captures);
  assert.equal(browser.browserContexts().length, 1, 'all attempt contexts are closed');
});

test('temporary image responses (503, 429, empty file) retry the capture; the retry limit still applies', async t => {
  // While Drupal creates an image style derivative, other requests get 503
  // "Image generation in progress", or the web server already serves the
  // empty file that is still being written.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-image-busy-'));
  const requests = new Map();
  const server = http.createServer((request, response) => {
    const count = (requests.get(request.url) || 0) + 1;
    requests.set(request.url, count);
    if (request.url.endsWith('.svg')) {
      if (count === 1 && request.url.includes('empty')) {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': '0' });
        response.end();
        return;
      }
      const status = request.url.includes('rate') ? 429 : 503;
      if (count === 1 || request.url.includes('always')) {
        response.writeHead(status, { 'Content-Type': 'text/html', 'Retry-After': '1' });
        response.end('Image generation in progress. Try again shortly.');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<style>body{margin:0}</style><img src="${request.url}.svg">`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const captures = path.join(directory, 'captures');
  await fs.mkdir(captures);
  const config = { defaults: { waitUntil: 'load', fullPage: false },
    onReadyScript: ['hooks/load-lazy-images'], core: { temporaryErrorRetries: 1 } };
  const capture = url => captureScreenshots(browser, config,
    { scenarios: [{ url, label: url.slice(1) }], viewports: [{ label: 'phone', width: 100, height: 100 }] },
    captures, `http://127.0.0.1:${server.address().port}`, false, 'reference');

  await capture('/busy');
  await capture('/rate');
  await capture('/empty');
  assert.equal(requests.get('/busy.svg'), 2);
  assert.equal(requests.get('/rate.svg'), 2);
  assert.equal(requests.get('/empty.svg'), 2);
  const saved = await fs.readdir(captures);
  assert.equal(saved.length, 3);
  // The retried capture shows the image (red), not a broken-image placeholder.
  const page = await browser.newPage();
  for (const file of saved) {
    const data = (await fs.readFile(path.join(captures, file))).toString('base64');
    const pixel = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: 100, height: 100 });
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(50, 50, 1, 1).data];
    }, `data:image/png;base64,${data}`);
    assert.deepEqual(pixel, [255, 0, 0, 255], file);
  }
  await page.close();

  await assert.rejects(capture('/always'), /Image response: HTTP 503 \(text\/html\)/);
  assert.equal(requests.get('/always.svg'), 2, 'one retry, then the failure is reported');
  assert.equal((await fs.readdir(captures)).length, 3, 'a failed capture saves nothing');
  assert.equal(browser.browserContexts().length, 1, 'all attempt contexts are closed');
});
