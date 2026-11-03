const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const template = require('../config-default.json');

test('Backstop import adopts the capture limit and preserves existing worker overrides', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-import-workers-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const backstopPath = path.join(directory, 'backstop.json');
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(backstopPath, JSON.stringify({
    asyncCaptureLimit: 5, scenarios: [{ url: 'https://example.test/' }]
  }));
  const run = () => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../scripts/import.js'), `--backstop=${backstopPath}`
  ], { env: { ...process.env, EAGLEDIFF_DIR: directory, EAGLEDIFF_CONFIG: configPath,
    GLOBAL_EAGLEDIFF_CONFIG: configPath, EAGLEDIFF_SCRIPT_DIR: path.join(__dirname, '..') } });
  await run();
  assert.equal(JSON.parse(await fs.readFile(configPath)).core.workers, 5);
  await fs.writeFile(configPath, JSON.stringify({ core: { workers: 3 }, defaults: { carouselSelectors: [], captureBeyondViewport: false, waitForIframes: false, iframeTimeout: 123 } }));
  await run();
  assert.equal(JSON.parse(await fs.readFile(configPath)).core.workers, 3);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath)).defaults.carouselSelectors, []);
  assert.equal(JSON.parse(await fs.readFile(configPath)).defaults.captureBeyondViewport, false);
  assert.equal(JSON.parse(await fs.readFile(configPath)).defaults.waitForIframes, false);
  assert.equal(JSON.parse(await fs.readFile(configPath)).defaults.iframeTimeout, 123);
  await fs.writeFile(configPath, JSON.stringify({ core: { thresholdRate: 0.01 } }));
  await run();
  assert.equal(JSON.parse(await fs.readFile(configPath)).core.workers, 5);
  await fs.unlink(configPath);
  await fs.writeFile(backstopPath, JSON.stringify({ scenarios: [{ url: 'https://example.test/' }] }));
  await run();
  assert.equal(JSON.parse(await fs.readFile(configPath)).core.workers, template.core.workers);
});
