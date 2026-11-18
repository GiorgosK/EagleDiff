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
    error => error.code === 'EAGLEDIFF_IMAGE_TIMEOUT' && /warn-timeout.svg/.test(error.message));
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
  await page.setContent(`<img src="${base}/placeholder.svg" srcset="${base}/missing.svg 1x">`);
  await assert.rejects(load(page), error => error.message.includes(`${base}/missing.svg`),
    'Diagnostics must identify the selected responsive source rather than its valid fallback');
});

test('lazy source promotion preserves native loader layout initialization during scrolling', async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/image.svg' || request.url === '/native.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="580"><rect width="100%" height="100%" fill="green"/></svg>');
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<style>body{margin:0}img{display:block;width:300px;height:auto;aspect-ratio:1}</style>
      <div style="height:600px"></div><img id="lazy" width="600" height="580" data-src="/image.svg">
      <p>After the image</p><div style="height:400px"></div>
      <script>window.initialized=0;new IntersectionObserver(entries=>{
        if(!entries.some(entry=>entry.isIntersecting))return;
        const image=document.querySelector('img[data-src]');if(!image)return;
        const rect=image.getBoundingClientRect();if(rect.top>=innerHeight||rect.bottom<=0)return;
        if(location.search==='?new-hint')image.setAttribute('data-src','/native.svg');
        else image.src=location.search?'/native.svg':image.getAttribute('data-src');
        image.style.aspectRatio=image.getAttribute('width')+'/'+image.getAttribute('height');
        if(!location.search)image.removeAttribute('data-src');window.initialized++;
      }).observe(document.querySelector('#lazy'));</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 240 });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const capture = async nativeFirst => {
    await page.goto(url);
    if (nativeFirst) {
      await page.evaluate(() => scrollTo(0, 600));
      await page.waitForFunction(() => window.initialized === 1);
    }
    await load(page);
    const state = await page.$eval('#lazy', image => ({
      initialized: window.initialized, width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height, source: image.getAttribute('data-src'),
      nextY: document.querySelector('p').getBoundingClientRect().y
    }));
    return { state, png: Buffer.from(await page.screenshot({ fullPage: true })) };
  };
  const nativeFirst = await capture(true);
  assert.equal(nativeFirst.state.height, 290);
  const helperFirst = await capture(false);
  assert.deepEqual(helperFirst.state, nativeFirst.state);
  assert.deepEqual(helperFirst.png, nativeFirst.png);

  await page.goto(url + '?native-choice');
  await load(page);
  assert.equal(await page.$eval('#lazy', image => new URL(image.src).pathname), '/native.svg');
  assert.equal(await page.$eval('#lazy', image => image.getAttribute('data-src')), null);

  await page.goto(url + '?new-hint');
  await load(page);
  assert.equal(await page.$eval('#lazy', image => new URL(image.src).pathname), '/native.svg');

  await page.goto(url);
  await load(page, { imageReadinessFinalCheck: true });
  assert.equal(await page.evaluate(() => scrollY), 0, 'Final rechecks must not scroll again');
  assert.equal(await page.$eval('#lazy', image => image.getAttribute('data-src')), null);
  assert.equal(await page.$eval('#lazy', image => image.naturalWidth), 600);
});

test('a source changed during decoding is decoded again without accepting a broken replacement', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 40, height: 40 });
  const image = color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`);
  const red = image('red');
  const green = image('lime');
  const prepare = async replacement => {
    await page.goto('about:blank');
    await page.setContent(`<style>body{margin:0}</style><img width="40" height="40" src="${red}">`);
    await page.evaluate(replacement => {
      const original = HTMLImageElement.prototype.decode;
      window.originalDecode = original;
      window.decodeFailures = 0;
      HTMLImageElement.prototype.decode = function() {
        const pending = original.call(this);
        if (!this.dataset.switched) { this.dataset.switched = 'yes'; this.src = replacement; }
        return pending.catch(error => { window.decodeFailures++; throw error; });
      };
    }, replacement);
  };
  await prepare(green);
  await load(page, { imageReadinessFinalCheck: true });
  assert(await page.evaluate(() => window.decodeFailures > 0), 'The real decode promise must reject during source replacement');
  await page.evaluate(() => { HTMLImageElement.prototype.decode = window.originalDecode; });
  const png = await page.screenshot();
  const color = await page.evaluate(async source => {
    const img = new Image(); img.src = source; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(20, 20, 1, 1).data];
  }, 'data:image/png;base64,' + Buffer.from(png).toString('base64'));
  assert.deepEqual(color, [0, 255, 0, 255], 'Capture must contain the decoded replacement');
  await prepare('data:image/png,invalid');
  await assert.rejects(load(page, { imageReadinessFinalCheck: true }), /Cannot load image before capture/);
});
