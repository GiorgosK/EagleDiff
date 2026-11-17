const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const firstFrame = { config: { defaults: { videoCaptureMode: 'first-frame' } } };
const pause = require('../scripts/hooks/pause-media');

// Original fixture: one second red, then one second green; no runtime ffmpeg dependency.
// ffmpeg -f lavfi -i color=c=red:s=32x32:r=10:d=1 -f lavfi -i color=c=green:s=32x32:r=10:d=1
//   -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0' -c:v libvpx-vp9 -lossless 1 two-color-video.webm
async function setup(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  const source = 'data:video/webm;base64,' + (await fs.readFile(path.join(__dirname, 'fixtures/two-color-video.webm'))).toString('base64');
  return { page, source };
}

async function pixel(page) {
  return page.$eval('video', video => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
}

async function pngPixel(page, png) {
  return page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(20, 20, 1, 1).data];
  }, 'data:image/png;base64,' + Buffer.from(png).toString('base64'));
}

test('default placeholders preserve video geometry and stay unchanged after late sources or new videos', async t => {
  const { page, source } = await setup(t);
  await page.setContent(`<style>body{margin:0}video{width:80px;height:60px;border:2px solid black}</style>
    <video controls muted src="${source}"></video><p>After video</p>`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const geometry = () => page.$eval('video', video => {
    const rect = video.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height, document.querySelector('p').getBoundingClientRect().y];
  });
  const before = await geometry();
  await pause(page);
  assert.deepEqual(await geometry(), before);
  const screenshot = await page.screenshot();
  assert.deepEqual(await pngPixel(page, screenshot), [226, 229, 232, 255]);
  await page.$eval('video', (video, source) => {
    video.src = source; video.autoplay = true; video.play().catch(() => {});
  }, source);
  await page.waitForFunction(() => !document.querySelector('video').hasAttribute('src'));
  assert.deepEqual(await geometry(), before);
  assert(Buffer.from(await page.screenshot()).equals(Buffer.from(screenshot)));
  await page.evaluate(source => {
    const video = document.createElement('video'); video.src = source; video.autoplay = true;
    document.body.append(video);
  }, source);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => !video.hasAttribute('src')));
  assert(await page.$$eval('video', videos => videos.every(video => !video.hasAttribute('src') &&
    video.paused && !video.autoplay && getComputedStyle(video).backgroundColor === 'rgb(226, 229, 232)')));
});

test('placeholder mode does not wait for broken or unavailable video sources', async t => {
  const { page } = await setup(t);
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="img-src \'none\'; media-src \'none\'">' +
    '<video src="data:video/webm;base64,AAAA"></video><video preload="none" src="https://invalid.test/video.webm"></video>');
  await pause(page);
  assert(await page.$$eval('video', videos => videos.every(video => !video.hasAttribute('src') && !video.poster)));
  // The screenshot is decoded outside this CSP-restricted document.
  const png = await page.screenshot();
  await page.goto('about:blank');
  assert.deepEqual(await pngPixel(page, png), [226, 229, 232, 255]);
});

test('auto-sized placeholders have identical geometry before and after video metadata loads', async t => {
  const { page, source } = await setup(t);
  await page.setViewport({ width: 400, height: 400 });
  const capture = async loaded => {
    await page.goto('about:blank');
    await page.setContent(`<style>body{margin:0}video{width:100%;height:auto}</style>
      <video preload="none" muted src="${source}"></video><p>After video</p>`);
    if (loaded) {
      await page.$eval('video', video => { video.preload = 'auto'; video.load(); });
      await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
    } else {
      assert.equal(await page.$eval('video', video => video.readyState), 0);
    }
    await pause(page);
    const geometry = await page.$eval('video', video => ({
      width: video.getBoundingClientRect().width, height: video.getBoundingClientRect().height,
      nextY: document.querySelector('p').getBoundingClientRect().y
    }));
    return { geometry, png: Buffer.from(await page.screenshot()) };
  };
  const before = await capture(false);
  const after = await capture(true);
  assert.deepEqual(after.geometry, before.geometry);
  assert.deepEqual(after.png, before.png);
});

test('video mode defaults and scenario overrides survive config updates and imports', () => {
  const template = require('../config-default.json');
  const { updateConfig } = require('../scripts/config-update');
  const { buildImportedConfig } = require('../scripts/import');
  assert.equal(template.defaults.videoCaptureMode, 'placeholder');
  assert.equal(updateConfig({}, template).defaults.videoCaptureMode, 'placeholder');
  const updated = updateConfig({ defaults: { videoCaptureMode: 'first-frame' },
    scenarios: [{ url: '/', videoCaptureMode: 'placeholder' }] }, template);
  assert.equal(updated.defaults.videoCaptureMode, 'first-frame');
  assert.equal(updated.scenarios[0].videoCaptureMode, 'placeholder');
  assert.equal(pause.resolveOptions(updated, updated.scenarios[0]).mode, 'placeholder');
  assert.equal(pause.resolveOptions(updated).mode, 'first-frame');
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', videoCaptureMode: 'first-frame' },
    { url: 'https://example.test/two', videoCaptureMode: 'placeholder' }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].videoCaptureMode, 'first-frame');
  assert.equal(pause.resolveOptions(imported, imported.scenarios[1]).mode, 'placeholder');
  for (const mode of ['', false, 0, 'unknown']) {
    assert.throws(() => pause.resolveOptions({}, { videoCaptureMode: mode }), /videoCaptureMode/);
  }
});

test('invalid video modes fail before requests or output changes', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.config.defaults.videoCaptureMode = 'invalid';
  await fixture.save();
  assert.match((await fixture.run(['reference'], 1)).stderr, /videoCaptureMode/);
  assert.deepEqual(fixture.requests, []);
  await assert.rejects(fs.access(path.join(fixture.directory, '.reg')), { code: 'ENOENT' });
});

test('a stalled first-frame video has a bounded wait and an actionable error', async t => {
  const { page } = await setup(t);
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().includes('stall.test')) return; request.continue(); });
  await page.setContent('<video preload="none" src="https://stall.test/video.webm"></video>', { waitUntil: 'domcontentloaded' });
  await assert.rejects(pause(page, firstFrame), /Cannot prepare video[\s\S]*stall.test[\s\S]*Timed out after 15000ms/);
});

test('native videos seek to the same decoded first frame and resist late playback', async t => {
  const { page, source } = await setup(t);
  await page.setContent(`<video muted loop src="${source}"></video>`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await page.$eval('video', video => { video.currentTime = 1.4; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  assert((await pixel(page))[1] > 100, 'fixture must show the later green frame before preparation');
  await pause(page, firstFrame);
  const first = await page.$eval('video', video => ({ time: video.currentTime, paused: video.paused, autoplay: video.autoplay }));
  assert.deepEqual(first, { time: 0, paused: true, autoplay: false });
  const red = await pixel(page);
  assert(red[0] > 240 && red[1] < 10, `first frame should be red: ${red}`);
  const screenshot = await page.screenshot();
  await page.$eval('video', video => { video.play().catch(() => {}); });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await page.$eval('video', video => video.currentTime), 0);
  assert.equal(await page.$eval('video', video => video.paused), true);
  const after = await page.screenshot();
  assert(Buffer.from(after).equals(Buffer.from(screenshot)), 'screenshots must remain identical after a playback attempt');
  // Repeated preparation and a later source change must still decode the first frame.
  await page.$eval('video', (video, source) => { video.src = source; video.load(); }, source);
  await pause(page, firstFrame);
  assert.deepEqual(await pixel(page), red);
});

test('preload none loads its first frame; hidden, empty and audio elements do not block', async t => {
  const { page, source } = await setup(t);
  await page.setContent(`<video preload="none" src="${source}"></video>
    <div style="display:none"><video src="data:video/webm;base64,AAAA"></video></div>
    <video></video><audio></audio>`);
  await pause(page, firstFrame);
  assert((await pixel(page))[0] > 240);
  assert(await page.$$eval('video,audio', nodes => nodes.every(node => node.paused)));
});

test('broken visible videos fail with a useful source diagnostic', async t => {
  const { page } = await setup(t);
  await page.setContent('<video src="data:video/webm;base64,AAAA"></video>');
  await assert.rejects(pause(page, firstFrame), /Cannot prepare video before capture: data:video\/webm/);
});

test('runner prepares videos introduced after pause-media, and hook removal disables preparation', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  const { page, source } = await setup(t);
  fixture.pages['/one'] = '<style>body{margin:0}video{width:100px;height:100px}</style>';
  const lateHook = path.join(fixture.directory, 'late-video.js');
  await fs.writeFile(lateHook, `module.exports = async page => {
    await page.evaluate(source => {
      const video = document.createElement('video'); video.src = source;
      document.body.append(video);
      video.addEventListener('loadedmetadata', () => { video.currentTime = 1.4; }, { once: true });
    }, ${JSON.stringify(source)});
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.currentTime > 1 && !v.seeking && v.readyState >= 2; });
  };`);
  fixture.config.scenarios = [{ url: '/one' }];
  fixture.config.defaults.videoCaptureMode = 'first-frame';
  fixture.config.onReadyScript = ['hooks/pause-media', lateHook];
  await fixture.save();
  await fixture.run(['reference']);
  const filename = (await fixture.files())[0];
  const color = async () => {
    const png = await fs.readFile(path.join(fixture.directory, '.reg/reference', filename));
    return page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(50, 50, 1, 1).data];
    }, 'data:image/png;base64,' + png.toString('base64'));
  };
  const savedColor = await color();
  assert(savedColor[0] > 240, `saved PNG must contain the first red frame: ${savedColor}`);
  fixture.config.onReadyScript = [lateHook];
  await fixture.save();
  await fixture.run(['reference']);
  assert((await color())[1] > 100, 'without pause-media the saved PNG retains the later green frame');
});
