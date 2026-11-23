const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const guardCaptureResizes = require('../scripts/capture-resize-guard');

async function newPage(t, viewport) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport(viewport);
  return page;
}

// Chrome resizes the window during a beyond-viewport capture; responsive
// scripts (GSAP matchMedia, ScrollTrigger) would replay their animations.
test('full-page captures do not reach page resize or media query listeners', async t => {
  const page = await newPage(t, { width: 800, height: 300 });
  await guardCaptureResizes(page);
  const html = `<div style="height:2000px">tall</div>
    <script>
      window.events = [];
      addEventListener('resize', () => events.push('resize'));
      const query = matchMedia('(min-width: 600px)');
      const listener = () => events.push('change');
      query.addEventListener('change', listener);
      query.onchange = () => events.push('onchange');
      window.removed = matchMedia('(min-width: 600px)');
      const removedListener = () => events.push('removed');
      removed.addEventListener('change', removedListener);
      removed.removeEventListener('change', removedListener);
    </script>`;
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
  await page.screenshot({ fullPage: true, captureBeyondViewport: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(await page.evaluate(() => window.events), []);
  assert.equal(await page.evaluate(() => typeof matchMedia('(min-width: 600px)').onchange), 'object');
});
