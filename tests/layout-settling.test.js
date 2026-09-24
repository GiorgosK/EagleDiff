const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots, getScreenshotFileName } = require('../scripts/run');

test('captures updated page height after removal and frame-scheduled layout updates', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-layout-'));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html>
      <style>body { margin: 0 } main { height: 600px } footer { height: 100px }</style>
      <main></main><footer><a href="#cookies">Cookies</a></footer>
      <script>
        new MutationObserver(records => {
          if (!records.some(record => [...record.removedNodes].some(node => node.nodeName === 'FOOTER'))) return;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelector('main').style.height = location.pathname === '/grow' ? '900px' : '450px';
          }));
        }).observe(document.body, { childList: true });
      </script>`);
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await puppeteer.launch(buildBrowserLaunchOptions({ core: { protocolTimeout: 10000 } }));
  const viewport = { label: 'phone', width: 360, height: 200 };
  const scenarios = [{ url: '/shrink' }, { url: '/grow' }];
  const config = {
    defaults: { delay: 0, waitUntil: 'load', fullPage: true, removeSelectors: ['footer'] },
    viewports: [viewport], scenarios
  };
  await captureScreenshots(browser, config, config, directory,
    `http://127.0.0.1:${server.address().port}`, false, 'reference');
  for (const [index, height] of [450, 900].entries()) {
    const png = await fs.readFile(path.join(directory, getScreenshotFileName(scenarios[index], viewport)));
    // PNG IHDR stores width and height as big-endian integers.
    assert.equal(png.readUInt32BE(16), viewport.width);
    assert.equal(png.readUInt32BE(20), height);
  }
});
