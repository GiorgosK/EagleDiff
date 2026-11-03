const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const load = require('../scripts/hooks/load-lazy-images');
const responsive = require('../scripts/hooks/normalize-responsive-images');
const jpeg = require('../scripts/hooks/normalize-image-decoding');
const backgrounds = require('../scripts/hooks/wait-for-background-images');
const fixture = require('./helpers/cli-fixture');
const template = require('../config-default.json');

let browser, server, baseURL;
before(async () => {
  server = http.createServer((request, response) => {
    if (request.url.startsWith('/missing')) {
      response.writeHead(404);
      response.end();
    } else if (request.url.endsWith('.svg')) {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="green"/></svg>');
    } else {
      response.end('<main>Fixture</main>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch(buildBrowserLaunchOptions());
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setViewport({ width: 200, height: 160 });
  await page.goto(baseURL);
  return page;
}
function context() {
  return { scenario: {}, config: {}, reportWarning: () => assert.fail('A hidden empty placeholder must not require warning mode.') };
}

test('Cookiebot-style placeholders pass all image hooks without changing visible pixels', async t => {
  const page = await pageFixture(t);
  await page.setContent(`<main>Visible content<img id="real" src="${baseURL}/real.svg"></main>
    <div id="CybotCookiebotDialog"><img id="CybotCookiebotDialogPoweredbyImage" style="display:none" src="data:,"></div>`);
  const ctx = context();
  await load(page, ctx);
  await responsive(page, ctx);
  await jpeg(page, ctx);
  await backgrounds(page, ctx);
  assert.equal(await page.$eval('#real', image => image.naturalWidth), 64);
  assert.deepEqual(await page.$eval('#CybotCookiebotDialogPoweredbyImage', image => ({ src: image.src, width: image.naturalWidth })),
    { src: 'data:,', width: 0 });
  const actual = Buffer.from(await page.screenshot());
  assert.equal(actual.readUInt32BE(16), 200);
  assert.equal(actual.readUInt32BE(20), 160);
  await page.$eval('#CybotCookiebotDialog', banner => banner.remove());
  assert.deepEqual(Buffer.from(await page.screenshot()), actual);
});

test('each image hook independently skips empty placeholders excluded by common CSS', async t => {
  const page = await pageFixture(t);
  const markup = [
    '<img style="display:none" src="data:,">',
    '<div style="display:none"><img src="data:,"></div>',
    '<img style="visibility:hidden" src="data:,">',
    '<div style="visibility:hidden"><img src="data:,"></div>',
    '<img style="opacity:0" src="data:,">',
    '<div style="opacity:0"><img src="data:,"></div>',
    '<picture style="display:none"><source><img src="data:,"></picture>'
  ];
  for (const html of markup) {
    for (const hook of [load, responsive, backgrounds]) {
      await page.setContent(html);
      await hook(page, context());
      assert.equal(await page.$eval('img', image => image.src), 'data:,');
    }
  }
});

test('hidden placeholders with lazy or picture replacements load their real images first', async t => {
  const page = await pageFixture(t);
  await page.setContent(`<img id="lazy" style="display:none" src="data:," data-src="${baseURL}/lazy.svg">
    <img id="alias" style="visibility:hidden" src="data:," data-lazy-src="${baseURL}/alias.svg">
    <picture style="display:none"><source data-srcset="${baseURL}/picture.svg 1x"><img id="picture" src="data:,"></picture>`);
  const ctx = context();
  await load(page, ctx);
  await responsive(page, ctx);
  await backgrounds(page, ctx);
  for (const id of ['lazy', 'alias', 'picture']) {
    const image = await page.$eval('#' + id, element => ({ src: element.currentSrc, width: element.naturalWidth }));
    assert.equal(image.width, 64);
    assert.match(image.src, /\.svg$/);
  }
});

test('visible empty images, hidden real failures, and broken replacement candidates remain errors', async t => {
  const page = await pageFixture(t);
  const markup = [
    '<img src="data:,">',
    '<div style="visibility:hidden"><img style="visibility:visible" src="data:,"></div>',
    `<img style="display:none" src="${baseURL}/missing.svg">`,
    '<img style="display:none" src="data:image/png;base64,not-an-image">',
    `<picture style="display:none"><source srcset="${baseURL}/missing-picture.svg 1x"><img src="data:,"></picture>`
  ];
  for (const html of markup) {
    for (const hook of [load, responsive, backgrounds]) {
      await page.setContent(html);
      await assert.rejects(hook(page, context()), /Cannot (load|decode)/);
    }
  }
  await page.setContent(`<img style="display:none" src="data:," data-src="${baseURL}/missing-lazy.svg">`);
  await assert.rejects(load(page, context()), /missing-lazy.svg/);
});

test('CLI reference and comparison accept Cookiebot placeholders but preserve baselines on real image failure', async t => {
  const f = await fixture(t);
  f.config.onReadyScript = template.onReadyScript;
  f.config.defaults = { ...template.defaults, ...f.config.defaults };
  f.pages['/one'] += '<div id="CybotCookiebotDialog"><img id="CybotCookiebotDialogPoweredbyImage" style="display:none" src="data:,"></div>';
  await f.save();
  await f.run(['reference', '--workers=1']);
  await f.run(['test', '--workers=2']);
  const report = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.equal(report.passedItems.length, 2);
  const names = await f.files();
  const read = () => Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  const original = await read();
  f.pages['/missing.png'] = { status: 404, body: '' };
  f.pages['/one'] += '<img style="display:none" src="/missing.png">';
  for (const command of ['reference', 'test']) {
    assert.match((await f.run([command], 1)).stderr, /missing.png/);
    assert.deepEqual(await read(), original);
  }
});
