const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots, getScreenshotFileName } = require('../scripts/run');
const template = require('../config-default.json');
const waitForVerification = require('../scripts/hooks/wait-for-browser-verification');

let browser, server, baseURL, directory;
const hits = new Map();
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-verification-'));
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture').pathname;
    if (['/modules/contrib/botbuster/js/challenge.js', '/other-provider/verify.js'].includes(pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(`setTimeout(() => {
        if (['/challenge-error', '/challenge-custom-error'].includes(location.pathname)) {
          document.querySelector('#error, #verification-error').style.display = 'block';
        } else {
          document.cookie = 'verified=1; path=' + location.pathname;
          location.reload();
        }
      }, 400);`);
      return;
    }
    hits.set(pathname, (hits.get(pathname) || 0) + 1);
    const verified = (request.headers.cookie || '').includes('verified=1');
    if (pathname.startsWith('/challenge-') && (!verified || pathname === '/challenge-loop')) {
      response.writeHead(pathname === '/challenge-200' ? 200 : 503, { 'Content-Type': 'text/html' });
      const custom = pathname.includes('custom');
      const script = custom ? '/other-provider/verify.js' : '/modules/contrib/botbuster/js/challenge.js';
      const errorId = custom ? 'verification-error' : 'error';
      response.end(`<div id="${errorId}" style="display:none">Verification failed</div><script src="${script}"></script>`);
    } else if (['/outage', '/challenge-final-error', '/asset-503.jpg', '/frame-503'].includes(pathname)) {
      response.writeHead(503, { 'Content-Type': 'text/html' });
      response.end('<footer id="footer">Service unavailable</footer>');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<footer id="footer">Ready</footer><img src="/asset-503.jpg"><iframe src="/frame-503"></iframe>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch(buildBrowserLaunchOptions({ core: { protocolTimeout: 10000 } }));
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

function capture(url, browserVerification) {
  const config = {
    defaults: {
      delay: 0, waitUntil: 'domcontentloaded', fullPage: false,
      readySelector: '#footer', readyTimeout: 2000,
      browserVerification: { ...template.defaults.browserVerification, timeout: 1500 },
      failOnResponseStatusCodes: [404, 500, 502, 503, 504]
    },
    onReadyScript: ['hooks/wait-for-browser-verification', 'hooks/fail-on-response-status', 'hooks/wait-for-element']
  };
  return captureScreenshots(browser, config, {
    viewports: [{ label: 'phone', width: 360, height: 640 }],
    scenarios: [{ label: url, url, browserVerification }]
  }, directory, baseURL, false, 'test');
}

test('a 503 challenge completes normally and checks the final main-document status', async () => {
  await capture('/challenge-503');
  assert.equal(hits.get('/challenge-503'), 2);
  const filename = getScreenshotFileName({ url: '/challenge-503' }, { label: 'phone', width: 360, height: 640 });
  assert((await fs.stat(path.join(directory, filename))).size > 0);
});

test('older 200 challenge responses are also awaited', async () => {
  await capture('/challenge-200');
  assert.equal(hits.get('/challenge-200'), 2);
});

test('genuine 503 responses still fail, including after successful verification', async () => {
  await assert.rejects(capture('/outage'), /Blocked response status 503/);
  await assert.rejects(capture('/challenge-final-error'), /Blocked response status 503/);
  assert.equal(hits.get('/challenge-final-error'), 2);
});

test('failed and looping verification cannot produce a successful capture', async () => {
  await assert.rejects(capture('/challenge-error'), /Browser verification failed/);
  await assert.rejects(capture('/challenge-loop'), /Browser verification did not complete/);
});

test('another provider works through scenario selectors, including a custom error marker', async () => {
  await capture('/challenge-custom', {
    challengeSelectors: ['#unused-challenge-marker', 'script[src*="/other-provider/verify.js"]'],
    errorSelectors: '#verification-error'
  });
  assert.equal(hits.get('/challenge-custom'), 2);
  await assert.rejects(capture('/challenge-custom-error', {
    challengeSelectors: 'script[src*="/other-provider/verify.js"]',
    errorSelectors: '#verification-error'
  }), /Browser verification failed/);
});

test('unconfigured challenges keep normal HTTP checks and empty selectors disable waiting', async () => {
  await assert.rejects(capture('/challenge-custom-unconfigured'), /Blocked response status 503/);
  await assert.rejects(capture('/challenge-disabled', { challengeSelectors: [] }), /Blocked response status 503/);
  await waitForVerification({}, { config: {}, scenario: {} });
});
