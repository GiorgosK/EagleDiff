const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const http = require('node:http');
const { captureScreenshots, buildBrowserLaunchOptions } = require('../scripts/run');

test('retries disconnected browser creation and retains its replacement for later scenarios', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-browser-recovery-'));
  const server = http.createServer((req, res) => res.end('<p>Ready</p>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  let restarts = 0;
  const config = { core: { temporaryErrorRetries: 1 }, defaults: { fullPage: false, waitUntil: 'domcontentloaded' },
    viewports: [{ label: 'phone', width: 100, height: 100 }] };
  // Inject a disconnected browser between scenarios, including the case where
  // context creation fails before a page exists.
  browser.createBrowserContext = async () => { await browser.close(); throw new Error('Connection closed.'); };
  await captureScreenshots(browser, config, {
    scenarios: [{ url: '/one' }, { url: '/two' }], viewports: config.viewports
  }, directory, `http://127.0.0.1:${server.address().port}`, false, 'reference', { relaunchBrowser: async () => {
    restarts++; browser = await puppeteer.launch(buildBrowserLaunchOptions()); return browser;
  } });
  assert.equal(restarts, 1);
  assert.equal((await fs.readdir(directory)).length, 2);
});
