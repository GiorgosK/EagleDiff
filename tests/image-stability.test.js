const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const normalize = require('../scripts/hooks/normalize-image-decoding');
const hideDynamicElements = require('../scripts/hooks/hide-dynamic-elements');
const template = require('../config-default.json');

const exec = promisify(execFile);
let browser, server, cdn, baseURL, cdnURL, directory, jpeg;
let shade = 100;
const serve = (request, response) => {
  if (request.url === '/image.jpg') {
    response.writeHead(200, { 'Content-Type': 'image/jpeg' });
    response.end(jpeg);
  } else if (request.url === '/missing.jpg') {
    response.writeHead(404);
    response.end();
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<style>body{margin:0;background:rgb(${shade},${shade},${shade})}a{display:none}</style><a href="/page">Page</a><footer id="footer"></footer>`);
  }
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cli = (...args) => exec(process.execPath, [
  path.join(__dirname, '../bin/reg-suit.js'), '--dir', directory,
  '--script-dir', path.join(__dirname, '..'), ...args
], {
  env: {
    ...process.env,
    REG_SUIT_DIR: directory,
    REG_SUIT_CONFIG: path.join(directory, 'config.json'),
    GLOBAL_REG_SUIT_CONFIG: path.join(directory, 'config.json')
  }
});

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-image-test-'));
  server = http.createServer(serve);
  cdn = http.createServer(serve);
  await listen(server);
  await listen(cdn);
  baseURL = `http://127.0.0.1:${server.address().port}`;
  cdnURL = `http://127.0.0.1:${cdn.address().port}`;
  browser = await puppeteer.launch(buildBrowserLaunchOptions());
  const page = await browser.newPage();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = 'blue';
    ctx.fillRect(400, 0, 400, 400);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  jpeg = Buffer.from(encoded, 'base64');
  await page.close();
});

after(async () => {
  await browser?.close();
  for (const service of [server, cdn]) {
    if (service?.listening) await new Promise(resolve => service.close(resolve));
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

test('new configs include the image stability defaults', async () => {
  await cli('config', '--', `--ref=${baseURL}`, `--test=${baseURL}`, '--limit=1');
  const config = JSON.parse(await fs.readFile(path.join(directory, 'config.json')));
  assert.deepEqual(config.scenarios, [{ url: '/', label: 'Homepage' }]);
  assert.equal(config.core.thresholdRateColor, 0.05);
  assert.equal(config.core.thresholdRate, 0.001);
  assert(config.defaults.hideSelectors.includes('[id^="div-gpt-ad"]'));
  assert.deepEqual(config.onReadyScript, template.onReadyScript);
  assert(config.onReadyScript.indexOf('hooks/wait-for-element') < config.onReadyScript.indexOf('hooks/wait-until-gone'));
  assert(config.onReadyScript.indexOf('hooks/normalize-image-decoding') > config.onReadyScript.indexOf('hooks/normalize-responsive-images'));
});

test('config refresh keeps the frontpage first without losing scenario settings', async () => {
  const configPath = path.join(directory, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath));
  const frontpage = { url: '/', label: 'Custom homepage', delay: 123 };
  const existingPage = { url: '/page', label: 'Custom page' };
  config.scenarios = [existingPage, frontpage];
  await fs.writeFile(configPath, JSON.stringify(config));
  await cli('config', '--', '--limit=2');
  const refreshed = JSON.parse(await fs.readFile(configPath));
  assert.deepEqual(refreshed.scenarios, [frontpage, existingPage]);

  config.scenarios = [existingPage];
  await fs.writeFile(configPath, JSON.stringify(config));
  await cli('config', '--', '--limit=2');
  const added = JSON.parse(await fs.readFile(configPath));
  assert.deepEqual(added.scenarios, [{ url: '/', label: 'Homepage' }, existingPage]);
});

test('explicit thresholds survive config refresh and import', async () => {
  const configPath = path.join(directory, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath));
  config.core = { thresholdRate: 0.02, thresholdRateColor: 0 };
  await fs.writeFile(configPath, JSON.stringify(config));
  await cli('config', '--', '--limit=1');
  const refreshed = JSON.parse(await fs.readFile(configPath));
  assert.deepEqual(refreshed.core, { ...template.core, thresholdRate: 0.02, thresholdRateColor: 0 });

  config.core.thresholdRateColor = 0.12;
  await fs.writeFile(configPath, JSON.stringify(config));
  const backstopPath = path.join(directory, 'backstop.json');
  await fs.writeFile(backstopPath, JSON.stringify({
    scenarios: [{ label: 'fixture', url: baseURL, referenceUrl: baseURL }]
  }));
  await cli('import', `--backstop=${backstopPath}`);
  const imported = JSON.parse(await fs.readFile(configPath));
  assert.equal(imported.core.thresholdRateColor, 0.12);
  assert.equal(imported.core.thresholdRate, 0.02);
});

test('normalization preserves geometry, tolerates non-CORS CDNs, and reports broken images', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(baseURL);
  await page.setContent(`<img width="330" src="${baseURL}/image.jpg"><picture><source srcset="${baseURL}/image.jpg"><img width="165" src="${baseURL}/image.jpg"></picture><img width="80" src="${cdnURL}/image.jpg">`);
  await page.evaluate(() => Promise.all(Array.from(document.images, i => i.decode())));
  const geometry = () => page.$$eval('img', images => images.map(i => [i.width, i.height, i.naturalWidth, i.naturalHeight]));
  const original = await geometry();
  await normalize(page, { scenario: { normalizeImageDecodingSelectors: [] }, config: {} });
  assert.equal(await page.$eval('img', i => i.src), `${baseURL}/image.jpg`);
  await normalize(page, { scenario: {}, config: {} });
  assert.deepEqual(await geometry(), original);
  assert(await page.$eval('picture img', i => i.currentSrc.startsWith('blob:')));
  assert.equal(await page.$eval('picture source', i => i.hasAttribute('srcset')), false);
  assert.equal(await page.$eval('body > img:last-child', i => i.src), `${cdnURL}/image.jpg`);
  await page.evaluate(() => new Promise(resolve => {
    document.images[0].addEventListener('error', resolve, { once: true });
    document.images[0].src = '/missing.jpg';
  }));
  await assert.rejects(() => normalize(page, { scenario: {}, config: {} }), /404/);
});

test('cookie consent defaults hide CookieScript and Cookiebot, including late injection', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<main>Content</main><div id="CybotCookiebotDialog">Cookiebot</div><div id="CybotCookiebotDialogBodyUnderlay"></div>');
  await hideDynamicElements(page, { scenario: {}, config: template });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="cookiescript_injected_wrapper"><div id="cookiescript_injected" role="dialog">CookieScript</div></div>');
  });
  for (const selector of ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#cookiescript_injected_wrapper', '#cookiescript_injected']) {
    assert.equal(await page.$eval(selector, element => getComputedStyle(element).display), 'none');
  }
  assert.notEqual(await page.$eval('main', element => getComputedStyle(element).display), 'none');
  await page.setContent('<div id="cookiescript_injected" role="dialog">CookieScript</div>');
  await hideDynamicElements(page, { scenario: { hideDynamicSelectors: [] }, config: template });
  assert.notEqual(await page.$eval('#cookiescript_injected', element => getComputedStyle(element).display), 'none');
});

test('comparison ignores small colour noise but detects substantial visual changes', async () => {
  const config = {
    ...template,
    core: { ...template.core },
    referenceBaseURL: baseURL,
    testBaseURL: baseURL,
    defaults: { ...template.defaults, delay: 0, fullPage: false },
    viewports: [{ label: 'fixture', width: 100, height: 100 }],
    scenarios: [{ label: 'fixture', url: '/' }, { label: 'fixture', url: '/other' }]
  };
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  await cli('reference');
  shade = 105;
  await cli('test');
  const generated = JSON.parse(await fs.readFile(path.join(directory, '.reg/regconfig.generated.json')));
  assert.equal(generated.core.matchingThreshold, 0.05);
  const output = () => fs.readFile(path.join(directory, '.reg/run/out.json')).then(JSON.parse);
  assert.deepEqual((await output()).failedItems, []);
  assert.equal((await output()).passedItems.length, 2);
  await cli('test', '--', '--filter=/other');
  assert.equal((await output()).passedItems.length, 1);
  assert.deepEqual((await output()).newItems, []);
  assert.deepEqual((await output()).deletedItems, []);
  shade = 180;
  await cli('test');
  assert.equal((await output()).failedItems.length, 2);
  delete config.core.thresholdRateColor;
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  shade = 105;
  await cli('test');
  assert.equal((await output()).failedItems.length, 2);
});
