const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const normalize = require('../scripts/hooks/normalize-image-decoding');

// Two frames: red for 50ms, then green for 1000ms, looping.
const gif = Buffer.from('R0lGODlhCAAIAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBZAABACwAAAAACAAIAIEA/wAAAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7', 'base64');

test('GIF normalization freezes the first frame even after animation has advanced', async t => {
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/image.gif')) { response.writeHead(200, { 'Content-Type': 'image/gif' }); response.end(gif); }
    else response.end('<picture><source srcset="/image.gif 1x"><img id="animated" src="/image.gif" width="32" height="32"></picture>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await new Promise(resolve => setTimeout(resolve, 250));
  await normalize(page, { scenario: {}, config: {} });
  assert.match(await page.$eval('img', image => image.src), /^blob:/);
  assert.equal(await page.$eval('img', image => image.getBoundingClientRect().width), 32);
  assert.equal(await page.$eval('source', source => source.hasAttribute('srcset')), false);
  const pixel = () => page.$eval('img', image => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  assert.deepEqual(await pixel(), [255, 0, 0, 255]);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.deepEqual(await pixel(), [255, 0, 0, 255]);
  await page.setContent('<img src="/image.gif">');
  await normalize(page, { scenario: { normalizeImageDecodingSelectors: [] }, config: {} });
  assert.doesNotMatch(await page.$eval('img', image => image.src), /^blob:/);
});

test('a GIF without CORS permission keeps its working original and reports animation risk', async t => {
  const images = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/gif' }); response.end(gif);
  });
  await new Promise(resolve => images.listen(0, '127.0.0.1', resolve));
  const source = `http://127.0.0.1:${images.address().port}/image.gif`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<img src="${source}">`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close();
    for (const service of [server, images]) {
      service.closeAllConnections(); await new Promise(resolve => service.close(resolve));
    }
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const warnings = [];
  await normalize(page, { scenario: {}, config: {}, reportWarning: (code, message) => warnings.push({ code, message }) });
  assert.equal(await page.$eval('img', image => image.src), source);
  assert.equal(await page.$eval('img', image => image.naturalWidth), 8);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'gif-normalization-skipped');
  assert.match(warnings[0].message, /may keep animating/);
});
