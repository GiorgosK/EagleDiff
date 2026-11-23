const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const freezeScriptAnimations = require('../scripts/hooks/freeze-script-animations');
const pauseIntervals = require('../scripts/hooks/pause-intervals');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');

async function newPage(t, viewport = { width: 400, height: 300 }) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport(viewport);
  return page;
}

const context = (scenario = {}, warnings = []) => ({
  scenario, config: { defaults: {} }, reportWarning: (code, message) => warnings.push({ code, message })
});

// A logo marquee moved by requestAnimationFrame, the way GSAP and similar
// libraries do it, next to an element with a fixed inline transform.
const marquee = `<style>body{margin:0}#strip{width:800px;height:40px;background:linear-gradient(to right,blue 50%,lime 50%);will-change:transform}
  #still{transform:translateX(10px);width:20px;height:20px;background:red}</style>
  <div id="strip"></div><div id="still" style="transform: translateX(10px)"></div>
  <script>
    const strip = document.querySelector('#strip');
    const start = performance.now();
    (function frame(now) { strip.style.transform = 'translateX(' + (-((now - start) / 10) % 400) + 'px)'; requestAnimationFrame(frame); })(start);
  </script>`;

test('an endless script animation is put back at its untransformed position', async t => {
  const page = await newPage(t);
  await page.setContent(marquee);
  await new Promise(resolve => setTimeout(resolve, 200));
  await freezeScriptAnimations(page, context());
  const state = () => page.evaluate(() => ({
    strip: getComputedStyle(document.querySelector('#strip')).transform,
    willChange: getComputedStyle(document.querySelector('#strip')).willChange,
    still: getComputedStyle(document.querySelector('#still')).transform
  }));
  const first = await state();
  assert.equal(first.strip, 'none');
  assert.equal(first.willChange, 'auto');
  assert.equal(first.still, 'matrix(1, 0, 0, 1, 10, 0)', 'a transform that does not change is kept');
  // The script keeps writing inline styles; the captured state does not move.
  const png = await page.screenshot();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(await state(), first);
  assert(Buffer.from(await page.screenshot()).equals(Buffer.from(png)));
});

test('an entrance that starts late is waited for and keeps its final position', async t => {
  const page = await newPage(t);
  await page.setContent(`<div id="box" style="width:20px;height:20px;background:red;transform:translateY(40px)"></div>
    <script>
      const box = document.querySelector('#box');
      setTimeout(() => {
        const start = performance.now();
        (function frame(now) {
          const progress = Math.min(1, (now - start) / 700);
          box.style.transform = 'translateY(' + (40 - 30 * progress) + 'px)';
          if (progress < 1) requestAnimationFrame(frame);
        })(start);
      }, 150);
    </script>`);
  await freezeScriptAnimations(page, context());
  assert.equal(await page.$eval('#box', element => getComputedStyle(element).transform), 'matrix(1, 0, 0, 1, 0, 10)');
  assert.equal(await page.$eval('#box', element => element.hasAttribute('data-eaglediff-still')), false);
});

test('freezeScriptAnimations: false leaves script animations running; invalid values are rejected', async t => {
  const page = await newPage(t);
  await page.setContent(marquee);
  await freezeScriptAnimations(page, context({ freezeScriptAnimations: false }));
  assert.notEqual(await page.$eval('#strip', element => getComputedStyle(element).transform), 'none');
  await assert.rejects(freezeScriptAnimations(page, context({ freezeScriptAnimations: 'yes' })), /freezeScriptAnimations must be a boolean/);
  await assert.rejects(freezeScriptAnimations(page, context({ scriptAnimationTimeout: 0 })), /scriptAnimationTimeout must be a positive number/);
});

const rotator = `<p id="quote">first</p><p id="ticks">0</p><p id="late">waiting</p>
  <script>
    const quotes = ['first', 'second', 'third'];
    let index = 0, ticks = 0;
    window.rotation = setInterval(() => { document.querySelector('#quote').textContent = quotes[++index % 3]; }, 2000);
    setInterval(() => { document.querySelector('#ticks').textContent = String(++ticks); }, 50);
    setTimeout(() => { document.querySelector('#late').textContent = 'shown'; }, 300);
  </script>`;

async function loadRotator(page, scenario) {
  await pauseIntervals(page, { ...context(scenario), mode: 'before' });
  await page.goto(`data:text/html,${encodeURIComponent(rotator)}`);
  await new Promise(resolve => setTimeout(resolve, 2300));
  return page.evaluate(() => ({
    quote: document.querySelector('#quote').textContent,
    ticks: Number(document.querySelector('#ticks').textContent),
    late: document.querySelector('#late').textContent,
    cleared: (() => { try { clearInterval(window.rotation); return true; } catch { return false; } })()
  }));
}

test('repeating timers of 2 seconds or more do not run; short intervals and one-off timeouts do', async t => {
  const page = await newPage(t);
  const result = await loadRotator(page, {});
  assert.equal(result.quote, 'first', 'the rotation did not advance');
  assert.ok(result.ticks > 10, 'a short interval keeps running');
  assert.equal(result.late, 'shown', 'late content added by setTimeout still appears');
  assert.equal(result.cleared, true);
});

test('pauseIntervals: false lets long intervals run; invalid values are rejected', async t => {
  const page = await newPage(t);
  assert.equal((await loadRotator(page, { pauseIntervals: false })).quote, 'second');
  assert.throws(() => pauseIntervals.resolveOptions({}, { pauseIntervals: -1 }), /pauseIntervals must be a positive number/);
  assert.equal(pauseIntervals.resolveOptions({}, { pauseIntervals: 5000 }).minimumDelay, 5000);
});

test('config-update adds the new hooks and settings to existing configs', () => {
  const updated = updateConfig({
    defaults: {},
    onBeforeScript: ['hooks/disable-animations', 'hooks/apply-css-overrides'],
    onReadyScript: ['hooks/freeze-web-animations', 'hooks/stabilize-svg-animations']
  }, template);
  const after = (list, hook, previous) => assert.equal(list.indexOf(hook), list.indexOf(previous) + 1, `${hook} follows ${previous}`);
  after(updated.onBeforeScript, 'hooks/pause-intervals', 'hooks/disable-animations');
  after(updated.onReadyScript, 'hooks/freeze-script-animations', 'hooks/freeze-web-animations');
  assert.equal(updated.defaults.freezeScriptAnimations, true);
  assert.equal(updated.defaults.scriptAnimationTimeout, 5000);
  assert.equal(updated.defaults.pauseIntervals, 2000);
});
