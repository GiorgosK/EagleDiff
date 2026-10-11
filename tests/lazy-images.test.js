const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const load = require('../scripts/hooks/load-lazy-images');
const normalize = require('../scripts/hooks/normalize-responsive-images');
const normalizeDecoding = require('../scripts/hooks/normalize-image-decoding');

test('loads delayed lazy sources before normalization and reports failed image URLs', async t => {
  let missingJpegRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/missing.jpg')) { missingJpegRequests++; res.writeHead(404); res.end(); return; }
    if (req.url === '/missing.svg') { res.writeHead(404); res.end(); return; }
    if (req.url.endsWith('.svg')) {
      const placeholder = req.url === '/placeholder.svg';
      setTimeout(() => {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${placeholder ? 64 : 43}" height="43"><rect width="100%" height="100%" fill="red"/></svg>`);
      }, placeholder ? 0 : 500);
      return;
    }
    res.end('<html><body></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.setContent(`<img id="lazy" src="${base}/placeholder.svg" data-src="${base}/real.svg">
    <img id="alias" src="${base}/placeholder.svg" data-lazy-src="${base}/alias.svg">
    <picture><source data-srcset="${base}/responsive.svg 1x"><img id="responsive" src="${base}/placeholder.svg"></picture>
    <img id="native" loading="lazy" src="${base}/native.svg">`);
  await load(page);
  await normalize(page, { scenario: {}, config: {} });
  for (const id of ['lazy', 'alias', 'responsive', 'native']) {
    const actual = await page.$eval('#' + id, image => ({ src: image.currentSrc, width: image.naturalWidth, complete: image.complete }));
    assert(!actual.src.includes('placeholder'), JSON.stringify(actual));
    assert.equal(actual.width, 43);
    assert(actual.complete);
  }
  await page.setContent(`<img data-src="${base}/missing.svg">`);
  await assert.rejects(load(page), error => error.message.includes(`${base}/missing.svg`));
  await page.setContent(`<img data-src="${base}/timeout.svg">`);
  await assert.rejects(load(page, { scenario: { lazyImageTimeout: 10 } }), /timeout.svg[\s\S]*Timed out after 10ms/);
  await page.setContent(`<img data-src="${base}/warn-timeout.svg">`);
  await assert.rejects(load(page, { scenario: { lazyImageTimeout: 10, imageFailurePolicy: 'warn' } }),
    error => error.code === 'RSR_IMAGE_TIMEOUT' && /warn-timeout.svg/.test(error.message));
  await page.setContent(`<img width="40" height="30" src="${base}/missing.jpg?token=fixture">`);
  const warnings = [];
  const context = { scenario: {}, config: { defaults: { imageFailurePolicy: 'warn' } },
    reportWarning: (code, message) => warnings.push(message) };
  await load(page, context);
  await normalize(page, context);
  await normalizeDecoding(page, context);
  assert.equal(missingJpegRequests, 1, 'normalization must not refetch a known broken image');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 unresolved image.*imageFailurePolicy="warn"/);
  assert(!warnings[0].includes('token='));
  assert.equal(await page.$eval('img', image => image.naturalWidth), 0);
  await assert.rejects(load(page, { scenario: { imageFailurePolicy: 'error' }, config: context.config }), /missing.jpg/);
  await assert.rejects(load(page, { scenario: { imageFailurePolicy: 'invalid' } }), /imageFailurePolicy/);
});
