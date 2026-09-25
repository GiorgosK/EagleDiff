const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const replace = require('../scripts/hooks/replace-random-content');
const template = require('../config-default.json');

let browser;
before(async () => { browser = await puppeteer.launch(buildBrowserLaunchOptions()); });
after(async () => { await browser?.close(); });
const source = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`)}`;

test('defaults are opt-in and replacement follows responsive normalization', () => {
  assert.deepEqual(template.defaults.randomImage, []);
  assert.deepEqual(template.defaults.randomContent, []);
  assert.deepEqual(template.defaults.replaceContent, {});
  const index = template.onReadyScript.indexOf('hooks/replace-random-content');
  assert(index > template.onReadyScript.indexOf('hooks/normalize-responsive-images'));
  assert(index < template.onReadyScript.indexOf('hooks/normalize-image-decoding'));
});

test('replaceContent maps selectors to literal text while preserving matched elements', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<section class="hours" data-keep="yes"><b>Random</b></section><p class="hours">Other</p><div id="clear">Clear me</div><footer>Keep</footer>');
  await replace(page, { scenario: {}, config: { defaults: {
    randomContent: ['.hours'],
    replaceContent: { '.hours': '<b>Specific text</b>', '#clear': '', '.missing': 'Ignored' }
  } } });
  assert.deepEqual(await page.$$eval('.hours', elements => elements.map(e => [e.textContent, e.children.length])), [
    ['<b>Specific text</b>', 0], ['<b>Specific text</b>', 0]
  ]);
  assert.equal(await page.$eval('section', e => e.getAttribute('data-keep')), 'yes');
  assert.equal(await page.$eval('#clear', e => e.textContent), '');
  assert.equal(await page.$eval('footer', e => e.textContent), 'Keep');
});

test('replaceContent supports scenario overrides and rejects invalid mappings', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const config = { defaults: { replaceContent: { p: 'Default' } } };
  await page.setContent('<p>Original</p><aside>Original</aside>');
  await replace(page, { scenario: { replaceContent: {} }, config });
  assert.equal(await page.$eval('p', e => e.textContent), 'Original');
  await replace(page, { scenario: { replaceContent: { aside: 'Scenario' } }, config });
  assert.equal(await page.$eval('p', e => e.textContent), 'Original');
  assert.equal(await page.$eval('aside', e => e.textContent), 'Scenario');
  for (const value of [['p'], 'p', { p: 42 }, { ' ': 'Text' }]) {
    await assert.rejects(replace(page, { scenario: { replaceContent: value }, config }), /replaceContent/);
  }
});

test('different random image and text variants produce identical captures', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setViewport({ width: 400, height: 400 });
  const captures = [];
  for (const [color, text] of [['red', 'First movie'], ['blue', 'A much longer random movie title']]) {
    await page.setContent(`<style>body{margin:0}img{display:block;width:320px;height:auto}.background{width:100px;height:40px}</style><div class="banner"><picture><source srcset="${source(color)}"><img src="${source(color)}" data-src="original.jpg"></picture></div><h2 class="title">${text}</h2><p class="intro">${text}</p><div class="background" style="background-image:url('${source(color)}')"></div><footer>Unchanged</footer>`);
    await page.$eval('img', image => image.decode());
    const size = () => page.$eval('img', image => [image.offsetWidth, image.offsetHeight]);
    const original = await size();
    await replace(page, { scenario: {}, config: { defaults: {
      randomImage: ['.banner', '.background'],
      randomContent: [{ selector: '.title', text: 'Example movie' }, '.intro', '.not-present']
    } } });
    assert.deepEqual(await size(), original);
    assert.equal(await page.$eval('source', element => element.hasAttribute('srcset')), false);
    assert.equal(await page.$eval('img', element => element.hasAttribute('data-src')), false);
    assert.match(await page.$eval('img', element => decodeURIComponent(element.currentSrc)), /IMAGE PLACEHOLDER/);
    assert.equal(await page.$eval('footer', element => element.textContent), 'Unchanged');
    captures.push(await page.screenshot());
  }
  assert.deepEqual(captures[0], captures[1]);
});

test('scenario overrides disable replacements and explicit dimensions stabilize aspect ratio', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(`<img src="${source('red')}"><p>Original</p>`);
  await page.$eval('img', image => image.decode());
  const config = { defaults: { randomImage: ['img'], randomContent: ['p'] } };
  await replace(page, { scenario: { randomImage: [], randomContent: [] }, config });
  assert.equal(await page.$eval('p', element => element.textContent), 'Original');
  assert.equal(await page.$eval('img', element => element.src), source('red'));
  await replace(page, { scenario: {
    randomImage: [{ selector: 'img', width: 200, height: 100 }],
    randomContent: [{ selector: 'p', text: 'Custom' }]
  }, config });
  assert.deepEqual(await page.$eval('img', image => [image.naturalWidth, image.naturalHeight]), [200, 100]);
  assert.equal(await page.$eval('p', element => element.textContent), 'Custom');
  await assert.rejects(replace(page, { scenario: { randomImage: [{ selector: 'img', width: -1 }] }, config }), /positive numbers/);
});

test('whole-region replacement ignores varying internal markup', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const screenshots = [];
  for (const markup of ['<h2>Movie</h2><p>Description</p><time>Today</time>', '<article><a href="/other">Different content</a><ul><li>Random item</li></ul></article>']) {
    await page.setContent(`<style>.random-area{width:300px;min-height:150px;padding:20px;background:#eee}</style><section class="random-area">${markup}</section>`);
    await replace(page, { scenario: { randomContent: ['.random-area'] }, config: {} });
    assert.equal(await page.$eval('.random-area', element => element.children.length), 0);
    screenshots.push(await page.screenshot());
  }
  assert.deepEqual(screenshots[0], screenshots[1]);
});
