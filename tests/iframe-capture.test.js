const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const captureScreenshot = require('../scripts/capture-screenshot');
const { buildBrowserLaunchOptions, captureScreenshots, getScreenshotFileName } = require('../scripts/run');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');
const { prepareIframes, resolveOptions } = require('../scripts/iframe-capture');

async function fixture(t) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    if (request.headers.host.startsWith('frame.test') && request.url === '/never') return;
    if (request.headers.host.startsWith('frame.test') && request.url === '/outer') {
      response.end('<iframe src="/slow" width="300" height="1200"></iframe>'); return;
    }
    if (request.headers.host.startsWith('frame.test')) {
      const finish = () => response.end('<style>body{margin:0}div{height:800px;background:red}section{height:400px;background:lime}</style><div></div><section></section>');
      if (request.url === '/slow') setTimeout(finish, 250); else finish();
    }
    else if (request.url === '/viewport') response.end('<style>body{margin:0}main{height:100vh;background:red}footer{height:800px;background:lime}</style><main></main><footer></footer>');
    else if (request.url === '/hidden') response.end(`<iframe width="1" height="1" src="http://frame.test:${server.address().port}/never"></iframe><div style="position:absolute;opacity:0"><iframe width="320" height="1200" src="http://frame.test:${server.address().port}/never"></iframe></div><iframe style="display:none" src="http://frame.test:${server.address().port}/never"></iframe><style>body{margin:0}main{height:100vh;background:red}footer{height:800px;background:lime}</style><main></main><footer></footer>`);
    else response.end(`<style>body{margin:0}header{height:100px;background:blue}iframe{display:block;width:320px;height:1200px;border:0}footer{height:700px}</style><header></header><iframe src="http://frame.test:${server.address().port}${request.url === "/waiting" ? "/slow" : request.url === "/hanging" ? "/never" : request.url === "/nested" ? "/outer" : "/widget"}"></iframe><footer></footer>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const options = buildBrowserLaunchOptions();
  const browser = await puppeteer.launch({ ...options, args: [...options.args,
    '--site-per-process', '--no-proxy-server', '--host-resolver-rules=MAP frame.test 127.0.0.1'] });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-iframe-'));
  t.after(async () => {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { browser, directory, base: `http://127.0.0.1:${server.address().port}` };
}

test('viewport-expanding capture includes loaded cross-site iframe content and restores viewport on success and failure', async t => {
  const { browser, base, directory } = await fixture(t);
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 200, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'load' });
  const child = page.frames().find(frame => frame.url().includes('frame.test'));
  assert.equal(await child.evaluate(() => document.readyState), 'complete');
  const options = { fullPage: true, captureBeyondViewport: false };
  const png = Buffer.from(await captureScreenshot(page, options, async () => {
    assert.equal(await page.evaluate(() => innerHeight), 200);
  }));
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 2000);
  const colors = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [50, 150, 1200].map(y => [...ctx.getImageData(50, y, 1, 1).data]);
  }, png.toString('base64'));
  assert.deepEqual(colors, [[0, 0, 255, 255], [255, 0, 0, 255], [0, 255, 0, 255]]);
  assert.equal(await page.evaluate(() => innerHeight), 200);
  await assert.rejects(captureScreenshot(page, options, () => { throw new Error('Capture guard failed'); }), /Capture guard failed/);
  assert.equal(await page.evaluate(() => innerHeight), 200);
  await assert.rejects(captureScreenshot(page, { ...options, path: path.join(directory, 'missing', 'output.png') }), { code: 'ENOENT' });
  assert.equal(await page.evaluate(() => innerHeight), 200, 'failed screenshot writes restore the viewport');
});

test('runner honors default and scenario capture modes, including false overrides', async t => {
  const { browser, base, directory } = await fixture(t);
  const inspector = await browser.newPage();
  const pixel = png => inspector.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(50, 600, 1, 1).data];
  }, png.toString('base64'));
  const config = { defaults: { waitUntil: 'load', fullPage: true, captureBeyondViewport: false } };
  const scenarios = [
    { label: 'inherited', url: '/viewport' },
    { label: 'normal', url: '/viewport', captureBeyondViewport: true },
    { label: 'expanded', url: '/viewport', captureBeyondViewport: false }
  ];
  await captureScreenshots(browser, config, { scenarios, viewports: [{ label: 'small', width: 320, height: 200 }] }, directory, base, false, 'test');
  for (const scenario of scenarios) {
    const filename = getScreenshotFileName(scenario, { label: 'small', width: 320, height: 200 });
    const png = await fs.readFile(path.join(directory, filename));
    assert.equal(png.readUInt32BE(16), 320);
    assert.equal(png.readUInt32BE(20), 1000, filename);
    assert.deepEqual(await pixel(png), scenario.label === 'normal' ? [0, 255, 0, 255] : [255, 0, 0, 255], scenario.label);
  }
  assert.equal((await fs.readdir(directory)).length, 3);
  // Explicit false must also override an enabled default.
  config.defaults.captureBeyondViewport = true;
  const second = path.join(directory, 'second'); await fs.mkdir(second);
  await captureScreenshots(browser, config, { scenarios: [scenarios[2]], viewports: [{ label: 'small', width: 320, height: 200 }] }, second, base, false, 'test');
  const [filename] = await fs.readdir(second);
  const png = await fs.readFile(path.join(second, filename));
  assert.deepEqual(await pixel(png), [255, 0, 0, 255]);
});

test('invalid capture modes fail before browser access or output writes; config updates retain overrides', async () => {
  for (const value of ['false', 0, []]) {
    await assert.rejects(captureScreenshots(null, { defaults: { captureBeyondViewport: value } },
      { scenarios: [{ url: '/' }], viewports: [] }, '/unused', 'http://example.test', false, 'test'), /must be "auto" or a boolean/);
  }
  assert.equal(updateConfig({}, template).defaults.captureBeyondViewport, 'auto');
  assert.equal(updateConfig({ defaults: { captureBeyondViewport: false } }, template).defaults.captureBeyondViewport, false);
  assert.equal(updateConfig({ scenarios: [{ url: '/', captureBeyondViewport: false }] }, template).scenarios[0].captureBeyondViewport, false);
});

test('automatic defaults wait for a delayed visible iframe and capture its offscreen pixels', async t => {
  const { browser, base, directory } = await fixture(t);
  const hook = path.join(directory, 'start-frame.js');
  await fs.writeFile(hook, `module.exports = async page => {
    await page.evaluate(source => {
      document.body.innerHTML = '<style>body{margin:0}header{height:100px;background:blue}iframe{display:block;width:320px;height:1200px;border:0}footer{height:700px}</style><header></header><footer></footer>';
      const iframe = document.createElement('iframe'); iframe.src = source;
      document.querySelector('header').after(iframe);
    }, ${JSON.stringify(base.replace('127.0.0.1', 'frame.test') + '/slow')});
  };`);
  const config = { defaults: { waitUntil: 'domcontentloaded', fullPage: true, iframeTimeout: 3000 }, onReadyScript: ['scripts/hooks/prepare-iframes.js', hook] };
  const scenario = { url: '/viewport' };
  const viewport = { label: 'small', width: 320, height: 200 };
  await captureScreenshots(browser, config, { scenarios: [scenario], viewports: [viewport] }, directory, base, false, 'test');
  const png = await fs.readFile(path.join(directory, getScreenshotFileName(scenario, viewport)));
  const inspector = await browser.newPage();
  const pixel = await inspector.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(50, 1200, 1, 1).data];
  }, png.toString('base64'));
  assert.deepEqual(pixel, [0, 255, 0, 255]);
});

test('automatic detection skips hidden frames, preserves non-iframe layout, and allows disabling waits', async t => {
  const { browser, base, directory } = await fixture(t);
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 200 });
  await page.goto(base + '/viewport', { waitUntil: 'load' });
  assert.equal(await prepareIframes(page, resolveOptions({}, {})), false);
  assert.equal(await page.$eval('main', element => element.getBoundingClientRect().height), 200);
  await page.evaluate(source => {
    const hidden = document.createElement('div'); hidden.style.opacity = '0';
    const iframe = document.createElement('iframe'); iframe.src = source;
    hidden.append(iframe); document.body.append(hidden);
    const tiny = document.createElement('iframe'); tiny.width = tiny.height = '1'; tiny.src = source;
    document.body.append(tiny);
  }, base.replace('127.0.0.1', 'frame.test') + '/never');
  assert.equal(await prepareIframes(page, resolveOptions({ defaults: { iframeTimeout: 100 } }, {})), false);
  await page.evaluate(() => { document.querySelector('div').style.opacity = '1'; });
  assert.equal(await prepareIframes(page, resolveOptions({}, { waitForIframes: false })), true);
  assert.equal(await prepareIframes(page, resolveOptions({}, { waitForIframes: false, captureBeyondViewport: true })), false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('iframe timeouts stop capture, use configured retries, and leave no screenshots or contexts', async t => {
  const { browser, base, directory } = await fixture(t);
  const hook = path.join(directory, 'hanging-frame.js');
  await fs.writeFile(hook, `module.exports = async page => {
    await page.evaluate(source => {
      const iframe = document.createElement('iframe'); iframe.src = source;
      document.body.append(iframe);
    }, ${JSON.stringify(base.replace('127.0.0.1', 'frame.test') + '/never')});
  };`);
  const config = { core: { temporaryErrorRetries: 1 }, defaults: {
    waitUntil: 'domcontentloaded', iframeTimeout: 100, fullPage: true
  }, onReadyScript: [hook, 'hooks/prepare-iframes'] };
  const warnings = []; const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    await assert.rejects(captureScreenshots(browser, config, {
      scenarios: [{ url: '/viewport' }], viewports: [{ label: 'small', width: 320, height: 200 }]
    }, directory, base, false, 'test'), /Iframe did not finish loading within 100ms/);
  } finally { console.warn = originalWarn; }
  assert(warnings.some(message => message.includes('retrying 1/1')));
  assert.deepEqual(await fs.readdir(directory), ['hanging-frame.js']);
  assert.equal(browser.browserContexts().length, 1);
});

test('iframe options preserve overrides and reject invalid wait values before browser access', async () => {
  assert.deepEqual(resolveOptions({}, {}), { captureBeyondViewport: 'auto', waitForIframes: true, iframeTimeout: 30000 });
  assert.equal(resolveOptions({ defaults: { waitForIframes: true } }, { waitForIframes: false }).waitForIframes, false);
  for (const defaults of [{ waitForIframes: 'false' }, { iframeTimeout: 0 }, { iframeTimeout: -1 }]) {
    await assert.rejects(captureScreenshots(null, { defaults }, { scenarios: [{ url: '/' }], viewports: [] }, '/unused', 'http://example.test', false, 'test'), /must be/);
  }
  const updated = updateConfig({ defaults: { waitForIframes: false, iframeTimeout: 123, captureBeyondViewport: true } }, template);
  assert.equal(updated.defaults.waitForIframes, false);
  assert.equal(updated.defaults.iframeTimeout, 123);
  assert.equal(updated.defaults.captureBeyondViewport, true);
});

test('visible nested frames finish loading before preparation completes', async t => {
  const { browser, base } = await fixture(t);
  const page = await browser.newPage();
  await page.goto(base + '/nested', { waitUntil: 'domcontentloaded' });
  assert.equal(await prepareIframes(page, resolveOptions({}, { iframeTimeout: 3000 })), true);
  const nested = page.frames().find(frame => frame.url().endsWith('/slow'));
  assert(nested);
  assert.equal(await nested.evaluate(() => document.readyState), 'complete');
  assert.equal(await nested.$eval('section', section => section.getBoundingClientRect().height), 400);
});

test('removing the iframe hook skips waiting and automatic viewport adjustment without changing explicit capture modes', async t => {
  const { browser, base, directory } = await fixture(t);
  const hook = path.join(directory, 'insert-frame.js');
  await fs.writeFile(hook, `module.exports = async page => {
    await page.evaluate(source => {
      const iframe = document.createElement('iframe'); iframe.src = source;
      document.body.append(iframe);
    }, ${JSON.stringify(base.replace('127.0.0.1', 'frame.test') + '/never')});
  };`);
  const config = { defaults: { waitUntil: 'domcontentloaded', fullPage: true,
    waitForIframes: true, iframeTimeout: 100, captureBeyondViewport: 'auto' }, onReadyScript: [hook] };
  const scenario = { url: '/viewport' };
  const viewport = { label: 'small', width: 320, height: 200 };
  const capture = () => captureScreenshots(browser, config, { scenarios: [scenario], viewports: [viewport] }, directory, base, false, 'test');
  await capture();
  const filename = path.join(directory, getScreenshotFileName(scenario, viewport));
  const original = await fs.readFile(filename);
  const inspector = await browser.newPage();
  const pixel = png => inspector.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(50, 600, 1, 1).data];
  }, png.toString('base64'));
  assert.deepEqual(await pixel(original), [0, 255, 0, 255], 'without the hook, auto mode preserves the layout viewport');
  config.onReadyScript.push('hooks/prepare-iframes');
  await assert.rejects(capture(), /Hook: hooks\/prepare-iframes[\s\S]*Iframe did not finish loading/);
  assert.deepEqual(await fs.readFile(filename), original, 'failed preparation preserves the earlier capture');
  config.onReadyScript.pop();
  scenario.captureBeyondViewport = false;
  await capture();
  assert.deepEqual(await pixel(await fs.readFile(filename)), [255, 0, 0, 255], 'explicit viewport expansion still works without the hook');
});

test('config updates include the removable iframe hook and recognize an existing alias', () => {
  const updated = updateConfig({ defaults: { waitForIframes: false, captureBeyondViewport: true },
    onReadyScript: ['scripts/hooks/prepare-iframes.js'] }, template);
  assert.equal(updated.onReadyScript.filter(hook => hook.includes('prepare-iframes')).length, 1);
  assert.equal(updated.defaults.waitForIframes, false);
  assert.equal(updated.defaults.captureBeyondViewport, true);
  assert(updateConfig({}, template).onReadyScript.includes('hooks/prepare-iframes'));
});
