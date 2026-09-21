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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rsr-diagnostics-'));
  // No CORS header: the page can reference this image but cannot fetch its bytes.
  const cdn = http.createServer((req, res) => res.end('image'));
  await new Promise(resolve => cdn.listen(0, '127.0.0.1', resolve));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<img src="http://127.0.0.1:${cdn.address().port}/image.jpg"><footer></footer>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([server, cdn].map(service => new Promise(resolve => service.close(resolve))));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const config = {
    referenceBaseURL: baseURL, testBaseURL: baseURL,
    defaults: { delay: 0, waitUntil: 'domcontentloaded', fullPage: false, readySelector: 'footer' },
    onReadyScript: ['hooks/wait-for-element', 'hooks/normalize-image-decoding'],
    viewports: [{ label: 'phone', width: 100, height: 100 }],
    scenarios: [{ url: '/one' }, { url: '/two' }, { url: '/three' }]
  };
  const configPath = path.join(directory, 'config.json');
  const run = () => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/reg-suit.js'), '--dir', directory,
    '--script-dir', path.join(__dirname, '..'), 'reference', '--', '--workers=2'
  ], { timeout: 20000, env: { ...process.env, REG_SUIT_DIR: directory,
    REG_SUIT_CONFIG: configPath, GLOBAL_REG_SUIT_CONFIG: configPath } });
  await fs.writeFile(configPath, JSON.stringify(config));
  const result = await run();
  assert.equal((result.stderr.match(/Some cross-origin JPEG/g) || []).length, 1);
  assert.match(result.stderr, /allow CORS/);

  config.scenarios = [
    { url: '/missing', readySelector: '.missing', readyTimeout: 100 },
    { url: '/slow', delay: 60000 },
    { url: '/must-not-start' }
  ];
  await fs.writeFile(configPath, JSON.stringify(config));
  await assert.rejects(run(), error => {
    assert.equal(error.killed, false);
    assert.match(error.stderr, /Required readySelector "\.missing"/);
    assert.doesNotMatch(error.stdout, /must-not-start/);
    return true;
  });
});
