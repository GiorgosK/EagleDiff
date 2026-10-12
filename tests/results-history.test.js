const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readResults } = require('../scripts/results-history');

test('missing and empty history are accepted; corrupt history is identified and preserved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'results.json');
  assert.deepEqual(await readResults(file), []);
  for (const content of ['', ' \n\t', '[]']) {
    await fs.writeFile(file, content);
    assert.deepEqual(await readResults(file), []);
  }
  const previous = [{ run: 3, passed: 2 }];
  await fs.writeFile(file, JSON.stringify(previous));
  assert.deepEqual(await readResults(file), previous);
  for (const content of ['[broken', '{}', 'null']) {
    await fs.writeFile(file, content);
    await assert.rejects(readResults(file), error => error.message.includes(file));
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
});

test('successful comparison saves a new entry when history is empty', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-empty-history-'));
  // A different Node on PATH must not replace the runtime executing Eaglediff.
  const binDirectory = path.join(directory, 'bin');
  await fs.mkdir(binDirectory);
  await fs.writeFile(path.join(binDirectory, 'node'), '#!/bin/sh\necho "Unexpected Node from PATH" >&2\nexit 99\n', { mode: 0o755 });
  const server = http.createServer((req, res) => res.end('<h1>Stable page</h1>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const configPath = path.join(directory, 'config.json');
  const url = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(configPath, JSON.stringify({
    referenceBaseURL: url, testBaseURL: url,
    defaults: { delay: 0, waitUntil: 'load', fullPage: false },
    viewports: [{ label: 'phone', width: 100, height: 100 }],
    scenarios: [{ url: '/' }]
  }));
  const run = command => promisify(execFile)(process.execPath, [
    path.join(__dirname, '../bin/eaglediff.js'), '--dir', directory, command
  ], { timeout: 30000, env: { ...process.env, PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
    EAGLEDIFF_DIR: directory,
    EAGLEDIFF_CONFIG: configPath, GLOBAL_EAGLEDIFF_CONFIG: configPath } });
  await run('reference');
  const resultsPath = path.join(directory, 'results.json');
  await fs.writeFile(resultsPath, '');
  await assert.rejects(run('results'), error => {
    assert.match(error.stderr, /No results found/);
    assert.doesNotMatch(error.stderr, /JSON/);
    return true;
  });
  const { stdout } = await run('test');
  assert.match(stdout, /test completed in/);
  assert.doesNotMatch(stdout, /test failed/);
  const entries = await readResults(resultsPath);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].passed, 1);
  assert.equal(entries[0].ref, url);
  assert.equal(entries[0].test, url);
  assert.match((await run('results')).stdout, /passed=1/);
  await fs.writeFile(resultsPath, '[broken');
  await assert.rejects(run('test'), error => {
    assert.match(error.stderr, /Comparison completed, but failed to save results history to/);
    assert(error.stderr.includes(resultsPath));
    assert.match(error.stdout, /test failed in/);
    return true;
  });
  assert.equal(await fs.readFile(resultsPath, 'utf8'), '[broken');
});
