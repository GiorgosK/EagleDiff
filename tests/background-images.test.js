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

async function visibilityFixture(t) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith('/stall')) return;
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="lime"/></svg>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  return { browser, requests, base: `http://127.0.0.1:${server.address().port}` };
}

const strict = { scenario: { lazyImageTimeout: 150, imageFailurePolicy: 'error' } };

test('CSS-hidden backgrounds do not block capture, but become required when shown', async t => {
  const { browser, requests, base } = await visibilityFixture(t);
  const page = await browser.newPage(); await page.setViewport({ width: 100, height: 100 });
  await page.setContent(`<style>body{margin:0}.tile{width:100px;height:100px}</style>
    <div id="menu" style="display:none"><div class="tile" style="background-image:url('${base}/stall-menu.svg')"></div></div>
    <div class="tile" style="visibility:hidden;background-image:url('${base}/stall-hidden.svg')"></div>
    <div style="opacity:0"><div class="tile" style="opacity:1;background-image:url('${base}/stall-opacity.svg')"></div></div>
    <div style="content-visibility:hidden"><div class="tile" style="background-image:url('${base}/stall-content.svg')"></div></div>
    <main class="tile" style="position:absolute;left:0;top:0;background-image:url('${base}/visible.svg')"></main>`, { waitUntil: 'domcontentloaded' });
  await wait(page, strict);
  assert(!requests.includes('/stall-menu.svg'), 'do not initiate a download for the collapsed menu');
  const color = await page.evaluate(async png => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(50, 50, 1, 1).data];
  }, Buffer.from(await page.screenshot()).toString('base64'));
  assert.deepEqual(color, [0, 255, 0, 255]);
  await page.$eval('#menu', menu => { menu.style.display = 'block'; });
  await assert.rejects(wait(page, strict), error => {
    assert.equal(error.code, 'EAGLEDIFF_IMAGE_TIMEOUT'); assert.match(error.message, /stall-menu.svg/); return true;
  });
  assert(requests.includes('/stall-menu.svg'));
});

test('offscreen, visibility-overridden and shared visible backgrounds remain required', async t => {
  const { browser, base } = await visibilityFixture(t);
  for (const [source, html] of [
    ['stall-below.svg', `<div style="position:absolute;top:2000px;width:100px;height:100px;background-image:url('${base}/stall-below.svg')"></div>`],
    ['stall-override.svg', `<div style="visibility:hidden"><div style="visibility:visible;width:100px;height:100px;background-image:url('${base}/stall-override.svg')"></div></div>`],
    ['stall-shared.svg', `<div style="display:none;background-image:url('${base}/stall-shared.svg')"></div><div style="width:100px;height:100px;background-image:url('${base}/stall-shared.svg')"></div>`],
    ['stall-owner.svg', `<div style="content-visibility:hidden;width:100px;height:100px;background-image:url('${base}/stall-owner.svg')"></div>`]
  ]) {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await assert.rejects(wait(page, { scenario: { lazyImageTimeout: 150, imageFailurePolicy: 'warn' } }), error => {
        assert.equal(error.code, 'EAGLEDIFF_IMAGE_TIMEOUT'); assert(error.message.includes(source)); return true;
      });
    } finally { await page.close(); }
  }
});

test('canvas backgrounds stay strict and stalled foreground images become required when revealed', async t => {
  const { browser, base } = await visibilityFixture(t);
  for (const [source, html] of [
    ['stall-canvas.svg', `<!doctype html><html><head><style>body{margin:0;height:0;background-image:url('${base}/stall-canvas.svg')}</style></head><body></body></html>`],
    ['stall-image.svg', `<img style="display:none" src="${base}/stall-image.svg">`]
  ]) {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      if (source === 'stall-canvas.svg') assert.equal(await page.$eval('body', body => body.getBoundingClientRect().height), 0);
      else {
        await wait(page, strict);
        await page.$eval('img', image => { image.style.display = 'block'; });
      }
      await assert.rejects(wait(page, strict), error => {
        assert.equal(error.code, 'EAGLEDIFF_IMAGE_TIMEOUT'); assert(error.message.includes(source)); return true;
      });
    } finally { await page.close(); }
  }
});
