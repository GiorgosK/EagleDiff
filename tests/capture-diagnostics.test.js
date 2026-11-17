const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWarningReporter } = require('../scripts/warnings');
const waitForElement = require('../scripts/hooks/wait-for-element');
const readCaptureLog = require('./helpers/capture-log');

test('warnings are deduplicated by type for each run', () => {
  const messages = [];
  const report = createWarningReporter(message => messages.push(message));
  report('images', 'first');
  report('images', 'second');
  report('other', 'third');
  assert.deepEqual(messages, ['first', 'third']);
});

test('missing readiness marker identifies the selector and remedy', async () => {
  const page = {
    waitForSelector: async () => { throw new Error('Timeout'); },
    url: () => 'https://example.test/'
  };
  await assert.rejects(waitForElement(page, {
    scenario: {}, config: { defaults: { readySelector: '.footer', readyTimeout: 50 } }
  }), /Required readySelector "\.footer".*50ms.*defaults.readySelector/);
});

test('parallel captures warn once and stop other workers on missing readiness', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-diagnostics-'));
  // No CORS header: the page can reference this image but cannot fetch its bytes.
  const cdn = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  });
  await new Promise(resolve => cdn.listen(0, '127.0.0.1', resolve));
  const server = http.createServer((req, res) => {
    if (req.url === '/broken') {
      res.writeHead(302, { Location: '/gallery' });
      res.end();
      return;
    }
    if (req.url === '/missing.jpg') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/gallery') {
      res.end('<footer></footer><img src="/missing.jpg">');
      return;
    }
    res.end(`<img src="http://127.0.0.1:${cdn.address().port}/image.jpg"><footer></footer>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([server, cdn].map(service => new Promise(resolve => service.close(resolve))));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const config = {
    version: require('../config-default.json').version,
    referenceBaseURL: baseURL, testBaseURL: baseURL,
    defaults: { delay: 0, waitUntil: 'domcontentloaded', fullPage: false, readySelector: 'footer' },
    onReadyScript: ['hooks/wait-for-element', 'hooks/normalize-image-decoding'],
    viewports: [{ label: 'phone', width: 100, height: 100 }],
    scenarios: [{ url: '/one' }, { url: '/two' }, { url: '/three' }]
  };
  const configPath = path.join(directory, 'config.json');
  const run = (workers = 2) => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/eaglediff.js'), '--dir', directory,
    '--script-dir', path.join(__dirname, '..'), 'reference', '--', `--workers=${workers}`
  ], { timeout: 20000, env: { ...process.env, EAGLEDIFF_DIR: directory,
    EAGLEDIFF_CONFIG: configPath, GLOBAL_EAGLEDIFF_CONFIG: configPath } });
  await fs.writeFile(configPath, JSON.stringify(config));
  const result = await run();
  assert.equal((result.stderr.match(/Some JPEG images/g) || []).length, 1);
  assert(result.stderr.includes(`Warning: ${baseURL}/`), 'Worker warnings must identify the complete capture URL first');
  const warningLog = readCaptureLog(result.stderr);
  assert.match(warningLog, /allow CORS/);
  assert.equal((warningLog.match(/WARNING image-normalization-skipped/g) || []).length, 1);

  config.scenarios = [{ url: '/broken', label: 'Broken gallery' }];
  await fs.writeFile(configPath, JSON.stringify(config));
  for (const workers of [1, 2]) {
    await assert.rejects(run(workers), error => {
      assert.match(error.stderr, /Broken gallery @ phone \(100x100\)/);
      const details = readCaptureLog(error.stderr);
      assert(details.includes(`Page URL: ${baseURL}/broken`));
      assert(details.includes(`Final page URL: ${baseURL}/gallery`));
      assert.match(error.stderr, /Hook: hooks\/normalize-image-decoding/);
      assert(details.includes(`Cannot normalize image (404): ${baseURL}/missing.jpg`));
      assert(error.stderr.split('\n').filter(Boolean).length <= 8, error.stderr);
      assert.equal((error.stderr.match(/Capture failed/g) || []).length, 1);
      assert.match(error.stdout, /reference failed in/);
      assert.doesNotMatch(error.stdout, /reference completed in/);
      return true;
    });
  }

  config.scenarios = [
    { url: '/missing', readySelector: '.missing', readyTimeout: 100 },
    { url: '/slow', delay: 60000 },
    { url: '/must-not-start' }
  ];
  await fs.writeFile(configPath, JSON.stringify(config));
  await assert.rejects(run(), error => {
    assert.equal(error.killed, false);
    assert.match(error.stderr, /Required readySelector "\.missing"/);
    assert(readCaptureLog(error.stderr).includes(`Page URL: ${baseURL}/missing`));
    assert.match(error.stderr, /Hook: hooks\/wait-for-element/);
    assert.doesNotMatch(error.stdout, /must-not-start/);
    return true;
  });
});
