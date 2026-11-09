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

test('display-none placeholders defer lazy replacements until revealed while visibility-hidden images still load', async t => {
  const page = await pageFixture(t);
  await page.setContent(`<img id="lazy" style="display:none" src="data:," data-src="${baseURL}/lazy.svg">
    <img id="alias" style="visibility:hidden" src="data:," data-lazy-src="${baseURL}/alias.svg">
    <picture style="display:none"><source data-srcset="${baseURL}/picture.svg 1x"><img id="picture" src="data:,"></picture>`);
  const ctx = context();
  await load(page, ctx);
  await responsive(page, ctx);
  await backgrounds(page, ctx);
  for (const id of ['lazy', 'picture']) {
    assert.equal(await page.$eval('#' + id, image => image.src), 'data:,');
  }
  assert.equal(await page.$eval('#alias', image => image.naturalWidth), 64);
  await page.$eval('#lazy', image => { image.style.display = ''; });
  await page.$eval('#picture', image => { image.closest('picture').style.display = ''; });
  await load(page, ctx);
  await responsive(page, ctx);
  await backgrounds(page, ctx);
  for (const id of ['lazy', 'alias', 'picture']) {
    const image = await page.$eval('#' + id, element => ({ src: element.currentSrc, width: element.naturalWidth }));
    assert.equal(image.width, 64);
    assert.match(image.src, /\.svg$/);
  }
});

test('visible, offscreen and layout-affecting broken images remain errors', async t => {
  const page = await pageFixture(t);
  const markup = [
    '<img src="data:,">',
    '<div style="visibility:hidden"><img style="visibility:visible" src="data:,"></div>',
    `<img style="visibility:hidden" src="${baseURL}/missing.svg">`,
    `<img style="opacity:0" src="${baseURL}/missing.svg">`,
    `<img style="position:absolute;top:2000px" src="${baseURL}/missing.svg">`,
    '<img src="data:image/png;base64,not-an-image">',
    `<picture><source srcset="${baseURL}/missing-picture.svg 1x"><img src="data:,"></picture>`
  ];
  for (const html of markup) {
    for (const hook of [load, responsive, backgrounds]) {
      await page.setContent(html);
      await assert.rejects(hook(page, context()), /Cannot (load|decode)/);
    }
  }
  await page.setContent(`<img src="data:," data-src="${baseURL}/missing-lazy.svg">`);
  await assert.rejects(load(page, context()), /missing-lazy.svg/);
});

test('every image hook skips display-none failures without promoting unused sources or changing pixels', async t => {
  const page = await pageFixture(t);
  for (const hook of [load, responsive, jpeg, backgrounds]) {
    await page.setContent(`<style>body{margin:0;background:lime}</style><main>Visible content</main>
      <section style="display:none">
        <img src="${baseURL}/missing.png"><img src="${baseURL}/missing.jpg">
        <img src="${baseURL}/missing.gif">
        <picture><source data-srcset="${baseURL}/missing-picture.svg 1x"><img src="data:," data-src="${baseURL}/missing-lazy.svg"></picture>
      </section>`);
    const before = Buffer.from(await page.screenshot());
    await hook(page, context());
    assert.equal(await page.$eval('source', source => source.hasAttribute('data-srcset')), true);
    assert.equal(await page.$eval('picture img', image => image.hasAttribute('data-src')), true);
    assert.deepEqual(Buffer.from(await page.screenshot()), before);
    await page.$eval('section', section => section.remove());
    assert.deepEqual(Buffer.from(await page.screenshot()), before);
  }
});

test('a broken image excluded at one breakpoint still fails when visible at another', async t => {
  const page = await pageFixture(t);
  for (const hook of [load, responsive, jpeg, backgrounds]) {
    await page.setViewport({ width: 200, height: 160 });
    await page.setContent(`<style>.responsive-panel{display:none}@media(min-width:300px){.responsive-panel{display:block}}</style>
      <div class="responsive-panel"><img src="${baseURL}/missing-breakpoint.jpg" width="40" height="30"></div>`);
    await hook(page, context());
    await page.setViewport({ width: 400, height: 160 });
    await assert.rejects(hook(page, context()), /Cannot (load|decode|normalize)/);
  }
});

test('images revealed by a later hook load before capture and broken reveals preserve references', async t => {
  const f = await fixture(t);
  const page = await pageFixture(t);
  const reveal = path.join(f.directory, 'reveal.js');
  await fs.writeFile(reveal, "module.exports = page => page.$eval('#panel', panel => { panel.style.display = 'block'; });");
  f.pages['/one'] = '<style>body{margin:0;background:lime}</style><section id="panel" style="display:none"><picture>' +
    '<source data-srcset="/revealed.svg 1x"><img width="100" height="100" data-src="/revealed.svg"></picture></section>';
  f.pages['/revealed.svg'] = { headers: { 'Content-Type': 'image/svg+xml' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' };
  f.config.scenarios = [{ url: '/one' }];
  f.config.onReadyScript = ['hooks/load-lazy-images', 'hooks/normalize-responsive-images',
    'hooks/normalize-image-decoding', 'hooks/wait-for-background-images', reveal];
  await f.save();
  await f.run(['reference']);
  assert(f.requests.includes('/revealed.svg'), 'the revealed lazy candidate must load');
  const baseline = path.join(f.directory, '.reg/reference', (await f.files())[0]);
  const png = await fs.readFile(baseline);
  assert.equal(png.readUInt32BE(16), 100);
  assert.equal(png.readUInt32BE(20), 100);
  const pixel = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(50, 50, 1, 1).data];
  }, 'data:image/png;base64,' + png.toString('base64'));
  assert.deepEqual(pixel, [0, 0, 255, 255]);
  f.pages['/revealed.svg'] = { status: 404, body: '' };
  assert.match((await f.run(['reference'], 1)).stderr, /Cannot load image/);
  assert.deepEqual(await fs.readFile(baseline), png);
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
  await f.run(['test']);
  assert.deepEqual(await read(), original);
  f.pages['/one'] += '<img src="/missing.png">';
  for (const command of ['reference', 'test']) {
    assert.match((await f.run([command], 1)).stderr, /missing.png/);
    assert.deepEqual(await read(), original);
  }
});
