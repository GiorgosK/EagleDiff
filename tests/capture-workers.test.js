const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getScreenshotFileName } = require('../scripts/run');

test('workers distribute scenario/viewport pairs without duplicate or missing captures', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-workers-'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<h1>${req.url}</h1>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const configPath = path.join(directory, 'config.json');
  const config = {
    referenceBaseURL: `http://127.0.0.1:${server.address().port}`,
    core: { workers: 4 },
    defaults: { delay: 0, waitUntil: 'load', fullPage: false },
    viewports: [
      { label: 'phone', width: 100, height: 120 },
      { label: 'tablet', width: 140, height: 160 },
      { label: 'pc', width: 180, height: 200 }
    ],
    scenarios: [{ label: 'One', url: '/one' }]
  };
  for (const [scenarioCount, workers, expectedWorkers, fromProject, omitConfigWorkers] of [[1, undefined, 3, true], [1, 2, 2, true], [1, undefined, 3], [1, 25, 3], [2, undefined, 4], [2, 4, 4], [2, 1, 1], [2, undefined, 6, false, true]]) {
    if (scenarioCount === 2 && config.scenarios.length === 1) {
      config.scenarios.push({ label: 'Two', url: '/two' });
    }
    await fs.writeFile(configPath, JSON.stringify(omitConfigWorkers ? { ...config, core: {} } : config));
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.join(__dirname, '../bin/eaglediff.js'), ...(fromProject ? [] : ['--dir', directory]),
      '--script-dir', path.join(__dirname, '..'), 'reference', ...(fromProject && workers !== undefined ? [] : ['--']), ...(workers === undefined ? [] : [`--workers=${workers}`])
    ], { timeout: 30000, cwd: fromProject ? directory : path.join(__dirname, '..'),
      env: { ...process.env, npm_config_workers: '', INIT_CWD: '', EAGLEDIFF_DIR: '', EAGLEDIFF_CONFIG: '',
        GLOBAL_EAGLEDIFF_CONFIG: '', npm_config_config: '' } });
    const progress = stdout.split('\n').filter(line => /^\[\d+\/\d+\]/.test(line));
    assert.equal(progress.length, scenarioCount * config.viewports.length);
    assert.equal(new Set(progress.map(line => line.match(/\[w(\d+)\]/)?.[1] || '1')).size, expectedWorkers);
    for (const scenario of config.scenarios) {
      for (const viewport of config.viewports) {
        assert.equal(progress.filter(line => line.endsWith(`${scenario.label} @ ${viewport.label}`)).length, 1);
        const png = await fs.readFile(path.join(directory, '.reg/reference', getScreenshotFileName(scenario, viewport)));
        assert.equal(png.readUInt32BE(16), viewport.width);
        assert.equal(png.readUInt32BE(20), viewport.height);
      }
    }
    assert.equal((await fs.readdir(path.join(directory, '.reg/reference'))).length, scenarioCount * config.viewports.length);
  }
});
