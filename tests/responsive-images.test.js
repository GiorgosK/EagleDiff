const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const normalize = require('../scripts/hooks/normalize-responsive-images');

test('responsive normalization keeps the loaded picture candidate and rejects failed decoding', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  // Blob URLs avoid commas in data URLs being interpreted as srcset separators.
  const [small, large] = await page.evaluate(sources => sources.map(s => URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }))), ['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>']);
  for (const selectors of [['img', 'picture source'], ['picture source']]) {
    await page.setContent(`<picture><source srcset="${small} 200w, ${large} 1000w" sizes="800px"><img src="${small}"></picture>`);
    await page.$eval('img', i => i.decode());
    assert.equal(await page.$eval('img', i => i.currentSrc), large);
    const naturalWidth = await page.$eval('img', i => i.naturalWidth);
    await normalize(page, { scenario: { normalizeResponsiveImageSelectors: selectors }, config: {} });
    assert.equal(await page.$eval('img', i => i.currentSrc), large);
    assert.equal(await page.$eval('img', i => i.naturalWidth), naturalWidth);
  }
  await page.setContent('<img alt="Placeholder">');
  await normalize(page, { scenario: {}, config: {} });
  await page.setContent('<img src="data:image/png,broken">');
  await assert.rejects(normalize(page, { scenario: {}, config: {} }), /Cannot decode responsive image/);
});
