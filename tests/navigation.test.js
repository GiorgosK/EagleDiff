const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const puppeteer = require('puppeteer-core');
const { navigate } = require('../scripts/navigation');
const { buildBrowserLaunchOptions } = require('../scripts/run');

test('navigation timeout identifies HTTP response, lifecycle and blocking request without query values', async t => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/hang.js')) return;
    res.setHeader('Content-Type', 'text/html');
    res.end('<script src="/hang.js?token=private"></script><h1>Blocked DOM</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(navigate(page, url, { waitUntil: 'domcontentloaded', timeout: 1000 }), error => {
    assert.match(error.message, /Phase: navigation; waitUntil="domcontentloaded"; timeout=1000ms/);
    assert.match(error.message, /Navigation responses: 200/);
    assert.match(error.message, /DOMContentLoaded=false; load=false/);
    assert.match(error.message, /script .*\/hang.js/);
    assert.match(error.message, /defaults.navigationTimeout/);
    assert.doesNotMatch(error.message, /private|token=/);
    return true;
  });
});

test('reference failure passes navigation details through workers and applies scenario settings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-navigation-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/hang.js') return;
    res.setHeader('Content-Type', 'text/html');
    res.end('<script src="/hang.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    referenceBaseURL: `http://127.0.0.1:${server.address().port}`,
    defaults: { waitUntil: 'load', navigationTimeout: 60000 },
    viewports: [{ label: 'phone', width: 100, height: 100 }],
    scenarios: [{ url: '/', label: 'Blocking script', waitUntil: 'domcontentloaded', navigationTimeout: 500 }]
  }));
  await assert.rejects(promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/eaglediff.js'), '--dir', directory,
    '--script-dir', path.join(__dirname, '..'), 'reference', '--', '--workers=2'
  ], { timeout: 15000, env: { ...process.env, EAGLEDIFF_DIR: directory,
    EAGLEDIFF_CONFIG: configPath, GLOBAL_EAGLEDIFF_CONFIG: configPath } }), error => {
    assert.match(error.stderr, /Blocking script @ phone/);
    assert.match(error.stderr, /waitUntil="domcontentloaded"; timeout=500ms/);
    assert.match(error.stderr, /\/hang.js/);
    assert.match(error.stderr, /remaining workers were cancelled/);
    assert.match(error.stdout, /reference failed/);
    return true;
  });
});
