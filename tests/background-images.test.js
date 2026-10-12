const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const wait = require('../scripts/hooks/wait-for-background-images');

test('background readiness checks every layer, handles failures, and bounds stalled downloads', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/stall')) return;
    if (req.url === '/missing.svg') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  const content = sources => page.setContent(`<div style='width:20px;height:20px;background-image:${sources.map(s => `url("${base}/${s}")`).join(',')}'></div>`, { waitUntil: 'domcontentloaded' });
  await content(['one.svg', 'two.svg']);
  await page.evaluate(() => document.body.appendChild(document.createElement('img')));
  await wait(page);
  assert(requests.includes('/one.svg') && requests.includes('/two.svg'));
  await content(['one.svg', 'missing.svg']);
  await assert.rejects(wait(page), /missing.svg/);
  const warnings = [];
  await wait(page, { scenario: { imageFailurePolicy: 'warn' }, reportWarning: (_, m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  await content(['stall.svg?secret=redacted']);
  await assert.rejects(wait(page, { scenario: { imageFailurePolicy: 'warn', lazyImageTimeout: 100 } }), error => {
    assert.equal(error.code, 'EAGLEDIFF_IMAGE_TIMEOUT');
    assert.match(error.message, /stall.svg/); assert.doesNotMatch(error.message, /secret/); return true;
  });
});
