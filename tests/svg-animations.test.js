const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');
const stabilize = require('../scripts/hooks/stabilize-svg-animations');

async function fixture(t) {
  const requests = new Map();
  const respond = (request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/player.svg' || request.url === '/blocked.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="box" x="50" width="50" height="100" fill="blue"/>
        <script><![CDATA[
          const box=document.getElementById('box');
          const timer=setInterval(()=>box.setAttribute('x',String(25+Math.random()*50)),20);
          document.documentElement.svgatorPlayer={ready:callback=>${request.url === '/blocked.svg' ? 'undefined' : 'setTimeout(callback,60)'},stop(){clearInterval(timer);box.setAttribute('x','0')}};
        ]]></script></svg>`);
    } else if (request.url === '/html') {
      response.end('<p>Ordinary frame</p><script>window.counter=0;setInterval(()=>window.counter++,20)</script>');
    } else if (request.url === '/blocked') {
      response.end('<object type="image/svg+xml" data="/blocked.svg" width="100" height="100"></object>');
    } else response.end('<main>Page</main>');
  };
  const server = http.createServer(respond);
  const assets = http.createServer(respond);
  await Promise.all([server, assets].map(service => new Promise(resolve => service.listen(0, '127.0.0.1', resolve))));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close();
    for (const service of [server, assets]) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
  });
  const page = await browser.newPage();
  return { page, requests, base: `http://127.0.0.1:${server.address().port}`, assetBase: `http://127.0.0.1:${assets.address().port}` };
}

test('native SVG motion freezes at zero with unchanged pixels over time', async t => {
  const { page } = await fixture(t);
  await page.setContent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="20" height="100" fill="blue"><animate attributeName="x" from="0" to="80" dur="1s" repeatCount="indefinite"/></rect></svg>');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert(await page.$eval('rect', rect => rect.x.animVal.value > 0));
  await stabilize(page);
  assert.equal(await page.$eval('rect', rect => rect.x.animVal.value), 0);
  assert.equal(await page.$eval('svg', svg => svg.animationsPaused()), true);
  const png = await page.screenshot();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert(Buffer.from(await page.screenshot()).equals(Buffer.from(png)));
});

test('embedded SVGator players stop and reset while ordinary HTML frames keep running', async t => {
  const { page, base, assetBase } = await fixture(t);
  await page.goto(base);
  await page.setContent(`<object type="image/svg+xml" data="${assetBase}/player.svg" width="100" height="100"></object><iframe src="${base}/html"></iframe>`);
  await stabilize(page);
  const svg = page.frames().find(frame => frame.url().endsWith('/player.svg'));
  assert.equal(await svg.$eval('#box', box => box.getAttribute('x')), '0');
  const normal = page.frames().find(frame => frame.url().endsWith('/html'));
  const counter = await normal.evaluate(() => window.counter);
  const png = await page.screenshot();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await svg.$eval('#box', box => box.getAttribute('x')), '0');
  assert(await normal.evaluate(previous => window.counter > previous, counter));
  assert(Buffer.from(await page.screenshot()).equals(Buffer.from(png)));
});

test('disabling leaves native playback alone and player readiness waits are bounded', async t => {
  const { page } = await fixture(t);
  await page.setContent('<svg width="100" height="100"><rect width="20" height="20"><animate attributeName="x" from="0" to="80" dur="1s" repeatCount="indefinite"/></rect></svg>');
  await stabilize(page, { scenario: { stabilizeSVGAnimations: false } });
  assert.equal(await page.$eval('svg', svg => svg.animationsPaused()), false);
  await page.$eval('svg', svg => { svg.svgatorPlayer = { ready() {}, stop() {} }; });
  await page.$eval('svg', svg => { svg.style.display = 'none'; });
  await stabilize(page, { scenario: { svgAnimationTimeout: 100 } });
  await page.$eval('svg', svg => { svg.style.display = ''; });
  await assert.rejects(stabilize(page, { scenario: { svgAnimationTimeout: 100 } }), error => error.code === 'EAGLEDIFF_SVG_ANIMATION_TIMEOUT');
});

test('readiness timeouts retry in fresh contexts without saving partial screenshots; disabling permits capture', async t => {
  const { page, base, requests } = await fixture(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-svg-timeout-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = { defaults: { waitUntil: 'domcontentloaded', svgAnimationTimeout: 100, fullPage: false },
    core: { temporaryErrorRetries: 1 }, onReadyScript: ['hooks/stabilize-svg-animations'] };
  const selection = { scenarios: [{ url: '/blocked' }], viewports: [{ label: 'phone', width: 100, height: 100 }] };
  await assert.rejects(captureScreenshots(page.browser(), config, selection, directory, base, false, 'reference'), /Cannot stabilize SVG animation/);
  assert.equal(requests.get('/blocked'), 2);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(page.browser().browserContexts().length, 1);
  config.defaults.stabilizeSVGAnimations = false;
  await captureScreenshots(page.browser(), config, selection, directory, base, false, 'reference');
  const png = await fs.readFile(path.join(directory, (await fs.readdir(directory))[0]));
  assert.equal(png.readUInt32BE(16), 100);
  assert.equal(png.readUInt32BE(20), 100);
});

test('invalid SVG settings are rejected before requests and capture output', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.defaults.svgAnimationTimeout = 0;
  await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /svgAnimationTimeout must be a positive number/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
});

test('SVG configuration preserves explicit disabling and scales retry budgets', () => {
  const template = require('../config-default.json');
  const { updateConfig } = require('../scripts/config-update');
  const { withRetryTimeouts } = require('../scripts/retry-timeouts');
  const { buildImportedConfig } = require('../scripts/import');
  assert.equal(updateConfig({}, template).defaults.stabilizeSVGAnimations, true);
  assert.equal(updateConfig({ defaults: { stabilizeSVGAnimations: false } }, template).defaults.stabilizeSVGAnimations, false);
  assert.equal(withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: 2 } }, { svgAnimationTimeout: 123 }, 1).scenario.svgAnimationTimeout, 246);
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', stabilizeSVGAnimations: false, svgAnimationTimeout: 123 },
    { url: 'https://example.test/two', stabilizeSVGAnimations: true, svgAnimationTimeout: 456 }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].stabilizeSVGAnimations, false);
  assert.equal(imported.scenarios[0].svgAnimationTimeout, 123);
  assert.throws(() => stabilize.resolveOptions({}, { stabilizeSVGAnimations: 'false' }), /boolean/);
  assert.throws(() => stabilize.resolveOptions({}, { svgAnimationTimeout: 0 }), /positive number/);
});
