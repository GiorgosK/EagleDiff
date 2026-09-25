const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const apply = require('../scripts/hooks/apply-css-overrides');
const waitForImages = require('../scripts/hooks/wait-for-background-images');
const template = require('../config-default.json');

let browser;
before(async () => { browser = await puppeteer.launch(buildBrowserLaunchOptions()); });
after(async () => { await browser?.close(); });

test('CSS overrides precede clipping and background loading in new configs', () => {
  assert.equal(template.defaults.cssOverrides, '');
  const hooks = template.onReadyScript;
  const index = hooks.indexOf('hooks/apply-css-overrides');
  assert(index > hooks.indexOf('hooks/replace-random-content'));
  assert(index < hooks.indexOf('hooks/keep-selectors'));
  assert(index < hooks.indexOf('hooks/wait-for-background-images'));
});

test('a fixed background makes different variants identical and respects media queries', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>')}`;
  const config = { defaults: { cssOverrides: `@media (min-width: 500px) { body { background-image: url("${image}") !important; } }` } };
  const captures = [];
  for (const color of ['red', 'blue']) {
    await page.setViewport({ width: 800, height: 300 });
    await page.setContent(`<style>body{margin:0;min-height:100vh}</style><body style="background-image:linear-gradient(${color},${color})"><img alt="Keep me"><p>Content</p></body>`);
    await apply(page, { scenario: {}, config });
    await waitForImages(page);
    assert.match(await page.$eval('body', e => getComputedStyle(e).backgroundImage), /data:image\/svg/);
    assert.equal(await page.$eval('img', e => e.alt), 'Keep me');
    captures.push(await page.screenshot());
    await page.setViewport({ width: 360, height: 300 });
    assert.match(await page.$eval('body', e => getComputedStyle(e).backgroundImage), /linear-gradient/);
  }
  assert.deepEqual(captures[0], captures[1]);
});

test('scenario CSS replaces defaults, empty CSS disables them, and invalid values fail', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const config = { defaults: { cssOverrides: 'body { background-color: red; }' } };
  await page.setContent('<body>Original</body>');
  await apply(page, { scenario: { cssOverrides: '' }, config });
  assert.equal(await page.$eval('body', e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  await apply(page, { scenario: { cssOverrides: 'body { color: blue; }' }, config });
  assert.deepEqual(await page.$eval('body', e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]), ['rgba(0, 0, 0, 0)', 'rgb(0, 0, 255)']);
  await assert.rejects(apply(page, { scenario: { cssOverrides: {} }, config }), /CSS string/);
});
