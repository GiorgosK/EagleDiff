const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const fixture = require('./helpers/cli-fixture');
const readLog = require('./helpers/capture-log');
const { getScreenshotFileName } = require('../scripts/run');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');

async function setup(t, workers) {
  const f = await fixture(t);
  f.config.core = { ...f.config.core, workers, temporaryErrorRetries: 2,
    temporaryErrorRetryMode: 'deferred', temporaryErrorRetryTimeoutMultiplier: 2 };
  f.config.viewports.push({ label: 'wide', width: 140, height: 120 });
  f.config.scenarios = ['/one', '/two', '/three'].map(url => ({ url, readyTimeout: 1000 }));
  f.pages['/three'] = '<h1>Three</h1>';
  const state = { counts: new Map(), events: [], behavior: 'once', active: 0, maxInitial: 0, maxRetry: 0 };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.test');
    const key = url.searchParams.get('path') + '@' + url.searchParams.get('width');
    const attempt = (state.counts.get(key) || 0) + 1;
    state.counts.set(key, attempt);
    state.active++;
    if (attempt === 1) state.maxInitial = Math.max(state.maxInitial, state.active);
    else state.maxRetry = Math.max(state.maxRetry, state.active);
    const files = await fs.readdir(path.join(f.directory, '.reg/actual')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    state.events.push({ key, attempt, priorCookie: url.searchParams.get('cookie'),
      timeout: Number(url.searchParams.get('timeout')), files: files.filter(file => file.endsWith('.png')).length });
    const eligible = ['one@100', 'two@100'].some(suffix => key === '/' + suffix);
    const fail = eligible && state.behavior !== 'none' &&
      (state.behavior === 'always' || attempt <= (state.behavior === 'twice' ? 2 : 1));
    const challenge = state.behavior === 'challenge-on-retry' && eligible && attempt > 1;
    await new Promise(resolve => setTimeout(resolve, 100));
    state.active--;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ fail, challenge }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const hook = path.join(f.directory, 'controlled-failure.js');
  await fs.writeFile(hook, `module.exports = async (page, context) => {
    const cookie = await page.evaluate(() => { const previous = document.cookie; document.cookie='attempt=present; path=/'; return previous; });
    const query = new URLSearchParams({ path: new URL(page.url()).pathname,
      width: String(page.viewport().width), cookie, timeout: String(context.scenario.readyTimeout) });
    const result = await fetch('http://127.0.0.1:${server.address().port}/?' + query).then(response => response.json());
    if(result.fail || result.challenge) {
      const error = new Error(result.challenge ? 'Fixture security challenge' : 'Temporary fixture network failure');
      error.code = result.challenge ? 'EAGLEDIFF_CHALLENGE_DETECTED' : 'EAGLEDIFF_READY_TIMEOUT';
      throw error;
    }
    await page.evaluate(() => { document.body.style.background='lime'; });
  };`);
  f.config.onReadyScript = [hook];
  await f.save();
  const reset = behavior => {
    state.counts.clear(); state.events = []; state.behavior = behavior;
    state.active = state.maxInitial = state.maxRetry = 0;
  };
  const references = async () => {
    const names = await f.files();
    return Promise.all(names.sort().map(async name => [name, (await fs.readFile(path.join(f.directory, '.reg/reference', name))).toString('base64')]));
  };
  return { ...f, state, reset, references };
}

function assertDeferredPass(f, expectedPairs = 6, failures = 2, retryCount = 1) {
  const initial = f.state.events.filter(event => event.attempt === 1);
  const retries = f.state.events.filter(event => event.attempt > 1);
  assert.equal(initial.length, expectedPairs);
  assert.equal(retries.length, failures * retryCount);
  assert(f.state.events.slice(0, expectedPairs).every(event => event.attempt === 1), 'Every initial capture precedes retries');
  assert.equal(retries[0].files, expectedPairs - failures, 'Successful initial screenshots exist before the first retry');
  assert.equal(f.state.maxRetry, 1, 'Deferred captures must never overlap');
  assert(f.state.events.every(event => !event.priorCookie), 'Every attempt starts in a fresh browser context');
  for (const event of f.state.events) assert.equal(event.timeout, 1000 * 2 ** (event.attempt - 1));
}

test('deferred reference, test and calibrate complete the first pass then recover failed pairs sequentially', async t => {
  for (const workers of [1, 3]) {
    const f = await setup(t, workers);
    for (const command of ['reference', 'test', 'calibrate']) {
      f.reset(command === 'reference' ? 'twice' : 'once');
      const result = await f.run([command]);
      assertDeferredPass(f, 6, 2, command === 'reference' ? 2 : 1);
      if (workers > 1) assert(f.state.maxInitial > 1, 'The initial pass really uses parallel workers');
      assert.match(result.stdout, /Retrying 2 failed capture\(s\) one at a time/);
      assert.match(result.stdout, /\[retry 1\/2\]/);
      assert.match(result.stdout, /\[retry 2\/2\]/);
      assert.match(readLog(result.stderr), /DEFERRED[\s\S]*Temporary fixture network failure/);
      assert.equal((await f.files()).length, 6);
      if (command !== 'reference') {
        const report = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
        assert.equal(report.passedItems.length, 6);
        assert.deepEqual(report.failedItems, []);
      }
    }
    const before = await f.references();
    f.reset('once');
    await f.run(['reference', '--filter=/one']);
    assertDeferredPass(f, 2, 1);
    assert.deepEqual(await f.references(), before, 'A deferred filtered reference preserves the full reference set');
    for (const scenario of f.config.scenarios) for (const viewport of f.config.viewports) {
      const png = await fs.readFile(path.join(f.directory, '.reg/reference', getScreenshotFileName(scenario, viewport)));
      assert.equal(png.readUInt32BE(16), viewport.width);
      assert.equal(png.readUInt32BE(20), viewport.height);
    }
  }
});

test('exhausted deferred captures do not prevent other queued retries or replace references and reports', async t => {
  for (const workers of [1, 3]) {
    const f = await setup(t, workers);
    f.reset('none'); await f.run(['reference']); await f.run(['test']);
    const before = await f.references();
    const pointer = await fs.readFile(path.join(f.directory, '.reg/reports/latest.json'));
    const history = await fs.readFile(path.join(f.directory, 'results.json'));
    for (const command of ['reference', 'test']) {
      f.reset('always');
      const result = await f.run([command], 1);
      assertDeferredPass(f, 6, 2, 2);
      assert.match(result.stderr, /2 deferred captures did not recover/);
      assert.match(readLog(result.stderr), /\/one[\s\S]*\/two/);
      assert.deepEqual(await f.references(), before);
      assert.deepEqual(await fs.readFile(path.join(f.directory, '.reg/reports/latest.json')), pointer);
      assert.deepEqual(await fs.readFile(path.join(f.directory, 'results.json')), history);
      await assert.rejects(fs.access(path.join(f.directory, '.reg/run/capture-manifest.json')), { code: 'ENOENT' });
      await f.run(['approve'], 1);
      assert.deepEqual(await f.references(), before);
    }
  }
});

test('zero retries and security challenges do not use deferred recovery', async t => {
  for (const workers of [1, 3]) {
    const f = await setup(t, workers);
    f.config.core.temporaryErrorRetries = 0; await f.save();
    const disabled = await f.run(['reference'], 1);
    assert.doesNotMatch(disabled.stdout + disabled.stderr, /retry deferred|\[retry /);
    assert(f.state.events.every(event => event.attempt === 1));

    f.config.core.temporaryErrorRetries = 2; await f.save(); f.reset('challenge-on-retry');
    const blocked = await f.run(['reference'], 1);
    assert.match(blocked.stderr, /Fixture security challenge/);
    assert.equal(f.state.events.filter(event => event.attempt > 1).length, 1, 'A challenge stops the serial queue immediately');
  }
});

test('retry-mode validation precedes requests and file mutations; config updates preserve saved choices', async t => {
  const f = await fixture(t);
  for (const mode of ['later', false, 0, {}, []]) {
    f.config.core.temporaryErrorRetryMode = mode; await f.save();
    const result = await f.run(['reference'], 1);
    assert.match(result.stderr, /temporaryErrorRetryMode/);
    assert.deepEqual(f.requests, []);
    await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
  }
  assert.equal(updateConfig({}, template).core.temporaryErrorRetryMode, 'immediate');
  for (const mode of ['immediate', 'deferred']) {
    const config = updateConfig({ core: { temporaryErrorRetryMode: mode, temporaryErrorRetries: 0 } }, template);
    assert.equal(config.core.temporaryErrorRetryMode, mode);
    assert.equal(config.core.temporaryErrorRetries, 0);
  }
});

test('permanent HTTP failures still stop without deferral', async t => {
  const f = await fixture(t);
  f.config.core.temporaryErrorRetryMode = 'deferred';
  f.config.core.temporaryErrorRetries = 2;
  f.config.onReadyScript = ['hooks/fail-on-response-status'];
  f.config.defaults.failOnResponseStatusCodes = [503];
  f.pages['/one'] = { status: 503, body: '<main>Unavailable</main>' };
  await f.save();
  const result = await f.run(['reference'], 1);
  assert.match(result.stderr, /Blocked response status 503/);
  assert.doesNotMatch(result.stdout + result.stderr, /retry deferred|\[retry /);
  assert.equal(f.requests.filter(url => url === '/one').length, 1);
});

test('cancelled deferred queues stop and imports retain the selected retry mode', async () => {
  const { runDeferredCaptures } = require('../scripts/deferred-retries');
  const { buildImportedConfig } = require('../scripts/import');
  let cancelled = false;
  const attempted = [];
  await assert.rejects(runDeferredCaptures([1, 2], async entry => {
    attempted.push(entry); cancelled = true;
  }, () => cancelled), /cancelled/);
  assert.deepEqual(attempted, [1]);
  for (const mode of ['immediate', 'deferred']) {
    const base = { ...template, core: { ...template.core, temporaryErrorRetryMode: mode } };
    const config = buildImportedConfig(base, template, { scenarios: [{ url: 'https://fixture.test/' }] },
      '/source/backstop.json', '/project/config.json');
    assert.equal(config.core.temporaryErrorRetryMode, mode);
  }
});

test('a real browser network failure is deferred until other pages finish', async t => {
  const f = await fixture(t);
  f.config.core = { ...f.config.core, workers: 2, temporaryErrorRetries: 1, temporaryErrorRetryMode: 'deferred' };
  const hook = path.join(f.directory, 'interrupt-navigation.js');
  await fs.writeFile(hook, `module.exports = async page => {
    const fs = require('node:fs');
    const marker = ${JSON.stringify(path.join(f.directory, 'interrupted-once'))};
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.isNavigationRequest() && new URL(request.url()).pathname === '/one' && !fs.existsSync(marker)) {
        fs.writeFileSync(marker, 'failed initial navigation'); request.abort('connectionreset');
      } else request.continue();
    });
  };`);
  f.config.onBeforeScript = [hook]; await f.save();
  const result = await f.run(['reference']);
  assert.match(result.stderr, /retry deferred until the end/);
  assert.match(readLog(result.stderr), /net::ERR_CONNECTION_RESET/);
  assert.match(result.stdout, /\[retry 1\/1\]/);
  assert(f.requests.indexOf('/two') < f.requests.indexOf('/one'));
  assert.equal((await f.files()).length, 2);
});
