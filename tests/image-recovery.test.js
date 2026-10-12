const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const zlib = require('node:zlib');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');

test('recovers a stalled image on the ready page, preserves cookies, and rejects unsuccessful recovery', async t => {
  const requests = new Map();
  let authenticatedRecovery = false;
  let jpeg;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-image-recovery-'));
  const server = http.createServer((req, res) => {
    const count = (requests.get(req.url) || 0) + 1;
    requests.set(req.url, count);
    if (req.url.startsWith('/stall.jpg')) {
      if (count === 1) return;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Encoding', 'gzip');
      res.end(zlib.gzipSync(jpeg)); return;
    }
    if (req.url === '/stall.svg') {
      if (count === 1) return;
      authenticatedRecovery = req.headers.cookie?.includes('fixture=yes') &&
        !req.headers.cookie.includes('foreign') && !req.headers.cookie.includes('private_only');
      if (!authenticatedRecovery) { res.writeHead(403); res.end(); return; }
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>');
      return;
    }
    if (req.url === '/always.svg') return;
    if (req.url === '/bad.svg') {
      if (count === 1) return;
      res.writeHead(404); res.end('Not an image'); return;
    }
    res.setHeader('Content-Type', 'text/html');
    const source = req.url === '/ready' ? '/stall.svg' : req.url === '/jpeg' ? '/stall.jpg?token=fixture#sample' : req.url === '/bad' ? '/bad.svg' : '/always.svg';
    if (req.url === '/ready') {
      res.end(`<img src="${source}" width="30" height="20"><script>
        addEventListener('load', () => {
          const button = document.createElement('button'); button.id = 'ready'; button.textContent = 'Ready'; document.body.append(button);
        });
      </script>`);
    } else res.end(`<button id="ready">Ready</button><img data-src="${source}" width="30" height="20">`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  const generator = await browser.newPage();
  jpeg = Buffer.from(await generator.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 30; canvas.height = 20;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 30, 20);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  }), 'base64');
  await generator.close();
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = {
    core: { temporaryErrorRetries: 0 },
    defaults: { waitUntil: 'domcontentloaded', fullPage: false, readySelector: '#ready', readyTimeout: 1000,
      lazyImageTimeout: 150, retryImageDownloads: true, imageDownloadTimeout: 1000,
      imageFailurePolicy: 'warn', cookies: [{ name: 'fixture', value: 'yes' },
        { name: 'foreign', value: 'fixture', domain: 'example.test' },
        { name: 'private_only', value: 'fixture', path: '/private-only' }] },
    onReadyScript: ['hooks/load-lazy-images', 'hooks/wait-for-element', 'hooks/normalize-responsive-images', 'hooks/wait-for-background-images'],
    viewports: [{ label: 'phone', width: 320, height: 480 }]
  };
  const capture = (url, overrides = {}) => captureScreenshots(browser, config,
    { scenarios: [{ url, ...overrides }], viewports: config.viewports }, directory,
    `http://127.0.0.1:${server.address().port}`, false, 'reference');
  await capture('/ready');
  assert.equal(requests.get('/ready'), 1, 'the ready page must not be restarted');
  assert.equal(requests.get('/stall.svg'), 2, 'one browser request and one recovery download');
  assert.equal(authenticatedRecovery, true);
  assert.equal((await fs.readdir(directory)).length, 1);
  const verify = path.join(directory, 'verify.js');
  await fs.writeFile(verify, `module.exports = async page => {
    const image = await page.$eval('img', img => ({src: img.src, width: img.naturalWidth}));
    if (!image.src.startsWith('blob:') || image.width !== 30) throw new Error('Recovered JPEG was not normalized.');
  };`);
  await capture('/jpeg', { onReadyScript: ['hooks/normalize-image-decoding', verify] });
  assert.equal(requests.get('/jpeg'), 1);
  assert.equal(requests.get('/stall.jpg?token=fixture'), 2);
  const countScreenshots = async () => (await fs.readdir(directory)).filter(name => name.endsWith('.png')).length;
  assert.equal(await countScreenshots(), 2);
  await assert.rejects(capture('/bad'), /Image recovery expected an image response; HTTP 404/);
  assert.equal(await countScreenshots(), 2);
  await assert.rejects(capture('/always', { imageDownloadTimeout: 150 }), /Image recovery download timed out/);
  assert.equal(await countScreenshots(), 2);
});
