const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const scroll = require('../scripts/hooks/scroll-to-bottom');
const waitForElement = require('../scripts/hooks/wait-for-element');

test('scroll reaches a footer that moves when lazy content expands, then returns to the top', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 200 });
  await page.setContent(`<style>body{margin:0}#spacer{height:600px}footer{height:40px}</style>
    <div id="spacer"></div><footer></footer><script>
    let expanded=false;
    addEventListener('scroll',()=>{if(!expanded && scrollY>=200){expanded=true;document.querySelector('#spacer').style.height='2000px'}});
    new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))document.querySelector('footer').innerHTML='<button id="newsletter">Subscribe</button>'}).observe(document.querySelector('footer'));
    </script>`);
  const context = { mode: 'ready', scenario: {}, config: { defaults: {
    scrollStepDelayMs: 20, scrollSettleDelayMs: 20, scrollTimeout: 3000,
    readySelector: '#newsletter', readyTimeout: 300, readyVisible: true
  } } };
  await scroll(page, context);
  await waitForElement(page, context);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.$eval('#spacer', e => e.getBoundingClientRect().height), 2000);
});

test('a page that prevents scrolling fails within the configured limit', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div style="height:4000px">Content</div><script>window.scrollTo = () => {};</script>');
  await assert.rejects(scroll(page, { mode: 'ready', scenario: {}, config: { defaults: {
    scrollStepDelayMs: 10, scrollSettleDelayMs: 10, scrollTimeout: 100
  } } }), error => error.code === 'RSR_SCROLL_TIMEOUT' && /scrolling is blocked/.test(error.message));
});
