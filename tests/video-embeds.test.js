const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const pause = require('../scripts/hooks/pause-media');
const { prepareIframes } = require('../scripts/iframe-capture');

async function setup(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 500 });
  // Serve every remote-looking embed locally through interception. No external requests.
  await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html',
    body: '<style>body{margin:0;background:lime}</style><p>Player or ordinary iframe</p>' }));
  return page;
}

const players = [
  'https://www.youtube.com/embed/example?autoplay=1',
  'https://www.youtube-nocookie.com/embed/example',
  'https://youtube.com/embed/videoseries?list=example',
  'https://player.vimeo.com/video/12345?background=1'
];
const ordinary = [
  'https://payments.example.test/embed/checkout',
  'https://www.youtube.com/watch?v=example',
  'https://www.youtube.com.example.test/embed/example',
  'https://vimeo.com/12345'
];

async function screenshotPixel(page, x, y) {
  const png = await page.screenshot();
  return pngPixel(page.browser(), png, x, y);
}

async function pngPixel(browser, png, x, y) {
  // Decode outside the inspected document's CSP.
  const decoder = await browser.newPage();
  try {
    return await decoder.evaluate(async ({ source, x, y }) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(x, y, 1, 1).data];
    }, { source: 'data:image/png;base64,' + Buffer.from(png).toString('base64'), x, y });
  } finally { await decoder.close(); }
}

test('YouTube and Vimeo placeholders preserve iframe geometry and ordinary frames', async t => {
  const page = await setup(t);
  const sources = [...players, ...ordinary];
  await page.setContent('<style>body{margin:0}iframe{width:100px;height:60px;border:2px solid black}</style>' +
    sources.map(src => `<iframe src="${src}"></iframe>`).join('') + '<p id="after">After players</p>');
  const geometry = () => page.$$eval('iframe,#after', nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height];
  }));
  const before = await geometry();
  await pause(page);
  await prepareIframes(page, { waitForIframes: true, iframeTimeout: 2000, captureBeyondViewport: 'auto' });
  assert.deepEqual(await geometry(), before);
  const actual = await page.$$eval('iframe', frames => frames.map(frame => frame.getAttribute('src')));
  assert.deepEqual(actual, [...players.map(() => 'about:blank'), ...ordinary]);
  assert.deepEqual(await screenshotPixel(page, 20, 20), [226, 229, 232, 255]);
  // The original player document was actually unloaded, not just covered.
  assert.equal(page.frames().filter(frame => players.includes(frame.url())).length, 0);
});

test('late and lazy iframe players become placeholders, including restored source URLs', async t => {
  const page = await setup(t);
  await page.setContent('<iframe data-src="https://www.youtube.com/embed/lazy" style="width:100px;height:60px"></iframe>' +
    '<iframe data-lazy-src="https://player.vimeo.com/video/12345"></iframe>');
  await pause(page);
  assert(await page.$$eval('iframe', frames => frames.every(frame => frame.src === 'about:blank' &&
    !frame.hasAttribute('data-src') && !frame.hasAttribute('data-lazy-src'))));
  await page.evaluate(() => {
    document.querySelector('iframe').src = 'https://www.youtube.com/embed/restarted?autoplay=1';
    const frame = document.createElement('iframe'); frame.src = 'https://player.vimeo.com/video/67890';
    document.body.append(frame);
  });
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 3 &&
    [...document.querySelectorAll('iframe')].every(frame => frame.getAttribute('src') === 'about:blank'));
  await prepareIframes(page, { waitForIframes: true, iframeTimeout: 2000, captureBeyondViewport: 'auto' });
  const point = await page.$eval('iframe', frame => {
    const rect = frame.getBoundingClientRect(); return { x: rect.x + 20, y: rect.y + 20 };
  });
  assert.deepEqual(await screenshotPixel(page, point.x, point.y), [226, 229, 232, 255]);
});

test('sandboxed players and restrictive image/style policies still show a placeholder', async t => {
  const page = await setup(t);
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="style-src \'none\'; img-src \'none\'">' +
    '<iframe sandbox="" width="100" height="60" src="https://www.youtube.com/embed/example"></iframe>');
  await pause(page);
  await prepareIframes(page, { waitForIframes: true, iframeTimeout: 2000, captureBeyondViewport: 'auto' });
  assert.deepEqual(await screenshotPixel(page, 20, 20), [226, 229, 232, 255]);
  assert.equal(await page.$eval('iframe', frame => frame.getAttribute('sandbox')), '');
});

test('first-frame mode leaves embedded players unchanged', async t => {
  const page = await setup(t);
  await page.setContent(players.map(src => `<iframe src="${src}"></iframe>`).join(''));
  await pause(page, { scenario: { videoCaptureMode: 'first-frame' } });
  assert.deepEqual(await page.$$eval('iframe', frames => frames.map(frame => frame.getAttribute('src'))), players);
  assert(await page.$$eval('iframe', frames => frames.every(frame => !frame.dataset.eaglediffVideoPlaceholder)));
});

test('runner replaces stalled players before iframe waiting; removing the hook preserves the failure and baseline', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  const before = path.join(fixture.directory, 'intercept-player.js');
  await fs.writeFile(before, `module.exports = async page => {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const host = new URL(request.url()).hostname;
      if (host === 'stalled-player-asset.test') return;
      if (host === 'www.youtube.com') return request.respond({ status: 200, contentType: 'text/html',
        body: '<p>Player loading</p><img src="https://stalled-player-asset.test/frame.png">' });
      request.continue();
    });
  };`);
  fixture.pages['/one'] = '<style>body{margin:0}</style><iframe width="80" height="60" src="https://www.youtube.com/embed/stalled"></iframe>';
  fixture.config.scenarios = [{ url: '/one' }];
  fixture.config.defaults.waitUntil = 'domcontentloaded';
  fixture.config.defaults.iframeTimeout = 1000;
  fixture.config.core.temporaryErrorRetries = 0;
  fixture.config.onBeforeScript = [before];
  fixture.config.onReadyScript = ['hooks/pause-media', 'hooks/prepare-iframes'];
  await fixture.save();
  await fixture.run(['reference']);
  const baseline = path.join(fixture.directory, '.reg/reference', (await fixture.files())[0]);
  const png = await fs.readFile(baseline);
  const page = await setup(t);
  assert.deepEqual(await pngPixel(page.browser(), png, 20, 20), [226, 229, 232, 255]);
  fixture.config.onReadyScript = ['hooks/prepare-iframes'];
  await fixture.save();
  const failure = await fixture.run(['reference'], 1);
  assert.match(failure.stderr, /Iframe did not finish loading/);
  assert.deepEqual(await fs.readFile(baseline), png);
});
