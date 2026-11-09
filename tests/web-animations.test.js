const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const freeze = require('../scripts/hooks/freeze-web-animations');
const template = require('../config-default.json');

async function fixture(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 120, height: 100 });
  await page.setContent('<style>body{margin:0;background:white}#strip{width:240px;height:100px;background:linear-gradient(to right,blue 0 50%,lime 50% 100%)}</style><div id="strip"></div>');
  return page;
}

async function createAnimation(page, iterations = 1) {
  await page.evaluate(iterations => {
    window.animation = document.querySelector('#strip').animate([
      { transform: 'translateX(0px)' }, { transform: 'translateX(-120px)' }
    ], { duration: 1000, iterations, fill: 'both' });
  }, iterations);
}

test('finite and infinite JavaScript strips capture the same first frame regardless of elapsed time', async t => {
  const page = await fixture(t);
  for (const iterations of [1, Infinity]) {
    await createAnimation(page, iterations);
    await page.evaluate(() => { window.animation.currentTime = 600; });
    await freeze(page);
    assert.deepEqual(await page.evaluate(() => [window.animation.playState, window.animation.currentTime]), ['paused', 0]);
    const png = await page.screenshot();
    await page.evaluate(() => { window.animation.play(); window.animation.reverse(); });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await page.evaluate(() => window.animation.currentTime), 0);
    assert(Buffer.from(await page.screenshot()).equals(Buffer.from(png)));
    await page.evaluate(() => window.animation.cancel());
  }
});

test('new animations are frozen immediately and disabling leaves playback unchanged', async t => {
  const page = await fixture(t);
  await freeze(page);
  await createAnimation(page);
  assert.deepEqual(await page.evaluate(() => [window.animation.playState, window.animation.currentTime]), ['paused', 0]);
  const disabled = await fixture(t);
  await freeze(disabled, { scenario: { freezeWebAnimations: false } });
  await createAnimation(disabled);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await disabled.evaluate(() => window.animation.playState), 'running');
  assert(await disabled.evaluate(() => window.animation.currentTime > 50));
});

test('CSS animations overriding duration rules are frozen while scroll-driven animations retain playback', async t => {
  const page = await fixture(t);
  await require('../scripts/hooks/disable-animations')(page);
  await page.addStyleTag({ content: '@keyframes fade {from{opacity:0}to{opacity:1}} #strip{animation:fade 10s infinite !important}' });
  assert.equal(await page.$eval('#strip', strip => getComputedStyle(strip).animationDuration), '10s');
  await page.evaluate(() => {
    document.body.style.height = '1000px';
    const marker = document.createElement('div'); marker.id = 'scroll-marker'; document.body.append(marker);
    window.scrolling = marker.animate([{ opacity: 0 }, { opacity: 1 }], {
      timeline: new ScrollTimeline({ source: document.documentElement }), fill: 'both'
    });
  });
  await freeze(page);
  assert.deepEqual(await page.evaluate(() => {
    const animation = document.getAnimations().find(animation => animation instanceof CSSAnimation);
    return [animation.playState, animation.currentTime];
  }), ['paused', 0]);
  await page.evaluate(() => window.scrolling.play());
  assert.equal(await page.evaluate(() => window.scrolling.playState), 'running');
});

test('CSS animations introduced after the hook are also frozen', async t => {
  const page = await fixture(t);
  await freeze(page);
  await page.addStyleTag({ content: '@keyframes slide {from{transform:translateX(0)}to{transform:translateX(-120px)}} #strip{animation:slide 1s infinite}' });
  await page.waitForFunction(() => document.getAnimations().some(animation => animation.playState === 'paused'));
  const before = await page.screenshot();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert(Buffer.from(await page.screenshot()).equals(Buffer.from(before)));
});

test('config updates, scenario precedence and imports preserve the disabling option', () => {
  const { updateConfig } = require('../scripts/config-update');
  const { buildImportedConfig } = require('../scripts/import');
  assert.equal(updateConfig({}, template).defaults.freezeWebAnimations, true);
  const updated = updateConfig({ defaults: { freezeWebAnimations: false } }, template);
  assert.equal(updated.defaults.freezeWebAnimations, false);
  assert.equal(freeze.resolveOptions(updated, { freezeWebAnimations: true }).enabled, true);
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', freezeWebAnimations: false },
    { url: 'https://example.test/two', freezeWebAnimations: true }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].freezeWebAnimations, false);
  assert.equal(freeze.resolveOptions(imported, imported.scenarios[1]).enabled, true);
  for (const value of ['', 0, 'false']) assert.throws(() => freeze.resolveOptions({}, { freezeWebAnimations: value }), /boolean/);
});

test('late animations using a saved native method are rechecked before the PNG; hook removal disables freezing', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.pages['/one'] = '<style>body{margin:0}#strip{width:200px;height:100px;background:linear-gradient(to right,blue 0 50%,lime 50% 100%)}</style>' +
    '<div id="strip"></div><script>window.savedAnimate=Element.prototype.animate;</script>';
  const late = path.join(f.directory, 'late-animation.js');
  await fs.writeFile(late, `module.exports = page => page.evaluate(() => {
    const animation = window.savedAnimate.call(document.querySelector('#strip'), [{transform:'translateX(0px)'},{transform:'translateX(-100px)'}], {duration:1000,fill:'both'});
    animation.currentTime=900;
  });`);
  f.config.scenarios = [{ url: '/one' }];
  f.config.onReadyScript = ['hooks/freeze-web-animations', late];
  await f.save();
  await f.run(['reference']);
  const baseline = path.join(f.directory, '.reg/reference', (await f.files())[0]);
  const page = await fixture(t);
  const pixel = async () => {
    const png = await fs.readFile(baseline);
    return page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(50, 50, 1, 1).data];
    }, 'data:image/png;base64,' + png.toString('base64'));
  };
  assert.deepEqual(await pixel(), [0, 0, 255, 255]);
  f.config.onReadyScript = [late];
  await f.save();
  await f.run(['reference']);
  assert.deepEqual(await pixel(), [0, 255, 0, 255]);
});

test('invalid animation settings fail before navigation and output creation', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.defaults.freezeWebAnimations = 'false';
  await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /freezeWebAnimations must be a boolean/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
});
