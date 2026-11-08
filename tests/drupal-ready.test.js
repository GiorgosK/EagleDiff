const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { captureScreenshots, buildBrowserLaunchOptions } = require('../scripts/run');
const wait = require('../scripts/hooks/wait-for-drupal-ready');
const jquery = require('../scripts/hooks/wait-for-jquery-ready');
const template = require('../config-default.json');
const { updateConfig } = require('../scripts/config-update');
const { buildImportedConfig } = require('../scripts/import');
const { withRetryTimeouts } = require('../scripts/retry-timeouts');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-drupal-ready-'));
  const requests = new Map();
  const core = `window.attachLog=[];window.Drupal={behaviors:{base:{attach(context, settings){attachLog.push({name:'base',full:context===document,setting:settings?.marker});}}},
    attachBehaviors:function(context,settings){window.lastAttachThis=this;for(const b of Object.values(this.behaviors))b.attach(context||document,settings)}};
    window.originalAttach=Drupal.attachBehaviors;
    window.jQuery=function(){return{ready:callback=>queueMicrotask(callback)}};jQuery.fn={ready:function(){}};`;
  const theme = `Drupal.behaviors.menu={attach(context){if(context!==document)return;document.querySelector('nav').hidden=true;
    if(!document.querySelector('img'))document.body.insertAdjacentHTML('beforeend','<img data-src="/green.svg" width="80" height="80">');attachLog.push({name:'menu',full:true});}};`;
  const server = http.createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    if (request.url === '/core.js' || request.url === '/theme.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(request.url === '/core.js' ? core : theme); return;
    }
    if (request.url === '/green.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="lime"/></svg>'); return;
    }
    response.setHeader('Content-Type', 'text/html');
    const late = request.url === '/late' || request.url === '/always' || (request.url === '/retry' && requests.get('/retry') === 1);
    const startup = late
      ? `Drupal.attachBehaviors(document,{marker:'startup'});document.write('<script src="/theme.js"><\\/script>');`
      : `document.addEventListener('DOMContentLoaded',()=>Drupal.attachBehaviors(document,{marker:'startup'}));`;
    response.end(`<style>body{margin:0;background:lime}nav{height:80px;background:red}</style><nav>Menu</nav>
      <script src="/core.js"></script>${late ? '' : '<script src="/theme.js"></script>'}<script>${startup}</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, requests, browser, base: `http://127.0.0.1:${server.address().port}` };
}

async function pageWithMonitor(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 100, height: 100 });
  await wait(page, { mode: 'before' });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

async function pngColor(browser, file) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(90, 70, 1, 1).data];
    }, (await fs.readFile(file)).toString('base64'));
  } finally { await page.close(); }
}

test('observes successful Drupal startup without invoking it, preserves arguments and restores the original function', async t => {
  const { browser, base } = await fixture(t);
  const page = await pageWithMonitor(browser, base + '/normal');
  await wait(page);
  assert.deepEqual(await page.evaluate(() => attachLog), [{ name: 'base', full: true, setting: 'startup' }, { name: 'menu', full: true }]);
  assert.equal(await page.evaluate(() => lastAttachThis === Drupal), true);
  assert.equal(await page.evaluate(() => Drupal.attachBehaviors === originalAttach), true);
  assert.equal(await page.evaluate(() => __eaglediffDrupalStartup.disposed), true);
  await wait(page); // A duplicate ready-hook entry is harmless.
  assert.equal(await page.$eval('nav', element => element.hidden), true);
});

test('jQuery readiness alone misses late Drupal behaviors; the guard waits for their real attachment and rechecks new images', async t => {
  const { browser, base, requests } = await fixture(t);
  const page = await pageWithMonitor(browser, base + '/late');
  await jquery(page);
  assert.equal(await page.$eval('nav', element => element.hidden), false, 'the existing jQuery hook cannot establish Drupal readiness');
  assert.equal(await page.evaluate(() => attachLog.length), 1);
  const waiting = wait(page, { scenario: { drupalReadyTimeout: 2000 } });
  await page.evaluate(() => setTimeout(() => Drupal.attachBehaviors(document, { marker: 'later-site-startup' }), 100));
  await waiting;
  assert.equal(await page.$eval('nav', element => element.hidden), true);
  assert.equal(await page.$eval('img', image => image.complete && image.naturalWidth === 80), true);
  assert.equal(requests.get('/green.svg'), 1);
  assert.equal(await page.evaluate(() => attachLog.filter(entry => entry.name === 'menu').length), 1, 'the site, not the hook, runs the behavior');
});

test('unattached behaviors time out without hiding the menu or calling initialization; partial attachments do not imply whole-page readiness', async t => {
  const { browser, base } = await fixture(t);
  const page = await pageWithMonitor(browser, base + '/late');
  await page.evaluate(() => Drupal.attachBehaviors(document.querySelector('nav')));
  const count = await page.evaluate(() => attachLog.length);
  await assert.rejects(wait(page, { scenario: { drupalReadyTimeout: 100 } }), error => {
    assert.equal(error.code, 'EAGLEDIFF_DRUPAL_READY_TIMEOUT'); assert.match(error.message, /menu/); return true;
  });
  assert.equal(await page.evaluate(() => attachLog.length), count);
  assert.equal(await page.$eval('nav', element => element.hidden), false);
  assert.equal(await page.evaluate(() => Drupal.attachBehaviors === originalAttach), true);
});

test('a startup failure retries in a fresh context; persistent failures produce no screenshot and worker count is preserved', async t => {
  const { browser, base, directory, requests } = await fixture(t);
  const config = { core: { workers: 15, temporaryErrorRetries: 1 }, defaults: { waitUntil: 'load', fullPage: false, drupalReadyTimeout: 150 },
    onBeforeScript: ['hooks/wait-for-drupal-ready'], onReadyScript: ['hooks/wait-for-jquery-ready', 'hooks/wait-for-drupal-ready'] };
  const selection = { scenarios: [{ url: '/retry' }], viewports: [{ label: 'phone', width: 100, height: 100 }] };
  await captureScreenshots(browser, config, selection, directory, base, false, 'reference');
  assert.equal(requests.get('/retry'), 2);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.deepEqual(await pngColor(browser, path.join(directory, files[0])), [0, 255, 0, 255]);
  selection.scenarios[0].url = '/always';
  await assert.rejects(captureScreenshots(browser, config, selection, directory, base, false, 'reference'), /Drupal startup did not attach/);
  assert.equal(requests.get('/always'), 2);
  assert.deepEqual(await fs.readdir(directory), files);
  assert.equal(browser.browserContexts().length, 1);
  assert.equal(config.core.workers, 15);
});

test('can disable or remove tracking, and non-Drupal pages do not acquire a Drupal global', async t => {
  const { browser, base } = await fixture(t);
  const page = await browser.newPage();
  const disabled = { mode: 'before', config: { defaults: { waitForDrupalReady: true } }, scenario: { waitForDrupalReady: false } };
  await wait(page, disabled);
  await page.goto(base + '/late', { waitUntil: 'load' });
  await wait(page, { ...disabled, mode: 'ready' });
  assert.equal(await page.evaluate(() => typeof __eaglediffDrupalStartup), 'undefined');
  assert.equal(await page.$eval('nav', element => element.hidden), false);
  await assert.rejects(wait(page), /both onBeforeScript and onReadyScript/);
  const plain = await pageWithMonitor(browser, 'data:text/html,<nav>Visible navigation</nav>');
  await wait(plain);
  assert.equal(await plain.evaluate(() => 'Drupal' in window), false);
  assert.equal(await plain.$eval('nav', element => element.hidden), false);
  assert.equal(await plain.evaluate(() => __eaglediffDrupalStartup.disposed), true);
});

test('default hook placement, config updates, imports and retry timeout overrides remain explicit', () => {
  assert(template.onBeforeScript.includes('hooks/wait-for-drupal-ready'));
  assert(template.onReadyScript.includes('hooks/wait-for-drupal-ready'));
  const updated = updateConfig({ defaults: { waitForDrupalReady: false, drupalReadyTimeout: 123 }, onBeforeScript: [], onReadyScript: [] }, template);
  assert.equal(updated.defaults.waitForDrupalReady, false);
  assert.equal(updated.defaults.drupalReadyTimeout, 123);
  assert(updated.onBeforeScript.includes('hooks/wait-for-drupal-ready'));
  assert(updated.onReadyScript.includes('hooks/wait-for-drupal-ready'));
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', waitForDrupalReady: false, drupalReadyTimeout: 123 },
    { url: 'https://example.test/two', waitForDrupalReady: true, drupalReadyTimeout: 456 }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].waitForDrupalReady, false);
  assert.equal(imported.scenarios[0].drupalReadyTimeout, 123);
  const scaled = withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: 2 }, defaults: { drupalReadyTimeout: 100 } }, { drupalReadyTimeout: 200 }, 1);
  assert.equal(scaled.config.defaults.drupalReadyTimeout, 200);
  assert.equal(scaled.scenario.drupalReadyTimeout, 400);
  assert.throws(() => wait.resolveOptions({}, { waitForDrupalReady: 'false' }), /boolean/);
  assert.throws(() => wait.resolveOptions({}, { drupalReadyTimeout: 0 }), /positive number/);
});

test('invalid Drupal startup settings fail before navigation and output writes', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.onBeforeScript = ['hooks/wait-for-drupal-ready'];
  f.config.onReadyScript = ['hooks/wait-for-drupal-ready'];
  for (const settings of [{ waitForDrupalReady: 'false' }, { waitForDrupalReady: true, drupalReadyTimeout: 0 }]) {
    Object.assign(f.config.defaults, settings); await f.save();
    const result = await f.run(['reference'], 1);
    assert.match(result.stderr, /waitForDrupalReady must be a boolean|drupalReadyTimeout must be a positive number/);
    assert.deepEqual(f.requests, []);
    await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
  }
});
