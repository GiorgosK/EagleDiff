const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCaptureDiagnostics } = require('../scripts/capture-diagnostics');
const { formatError } = require('../scripts/cli-error');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-capture-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = [];
  return { directory, output, reporter: createCaptureDiagnostics(directory, 'reference', message => output.push(message)) };
}

test('warnings and recovered retries retain full details in a private log and announce it once', async t => {
  const { directory, reporter, output } = await fixture(t);
  await assert.rejects(fs.access(path.join(directory, '.reg')));
  reporter.warning('cookie-domain', 'Warning: Cookies target another domain.\nSet cookieDomain="current" to apply them explicitly.');
  reporter.retry({ scenarioLabel: 'Example', viewportLabel: 'phone', url: 'https://example.test/page', attempt: 1, retries: 1,
    factor: 2, message: 'Hook: hooks/wait-for-drupal-ready\nDrupal startup was not confirmed.\nDetailed behavior list', details: 'Error: Hook: hooks/wait-for-drupal-ready\nDrupal startup was not confirmed.\nDetailed behavior list\n    at fixture.js:10' });
  assert.equal(output.length, 3);
  assert.equal(output.filter(line => line.startsWith('Details: ')).length, 1);
  assert.match(output[2], /Example @ phone: wait-for-drupal-ready failed; retrying 1\/1 \(timeouts 2x\)/);
  assert(!output.join('\n').includes('Detailed behavior list'));
  const file = output[1].slice('Details: '.length);
  const log = await fs.readFile(file, 'utf8');
  assert.match(log, /cookieDomain="current"/);
  assert.match(log, /https:\/\/example.test\/page/);
  assert.match(log, /Detailed behavior list/);
  assert.match(log, /at fixture.js:10/);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('final errors retain their full message and cause while rendering a short console summary', async t => {
  const { reporter, output } = await fixture(t);
  const cause = new Error('Original browser cause ' + 'x'.repeat(12000));
  const error = new Error('Capture failed [w2]: Example @ phone (320x480)\nPage URL: https://example.test/original\nFinal page URL: https://example.test/final\nHook: hooks/load-lazy-images\nCannot load image before capture\nhttps://example.test/broken.svg\nMore guidance', { cause });
  reporter.failure(error);
  assert.match(error.message, /More guidance/);
  assert.equal(error.cause, cause);
  assert.equal(output.length, 0);
  const rendered = formatError(error);
  assert.match(rendered, /Example @ phone/);
  assert.match(rendered, /load-lazy-images.*Cannot load image/);
  assert(!rendered.includes('More guidance'));
  const file = error.displayMessage.split('Details: ')[1];
  const log = await fs.readFile(file, 'utf8');
  assert.match(log, /https:\/\/example.test\/final/);
  assert.match(log, /More guidance/);
  assert.match(log, /Original browser cause/);
  assert(log.includes(cause.message), 'Long error details must not be truncated in the log');
});

test('logging failures preserve full console diagnostics and the original failure', async t => {
  const { directory, reporter, output } = await fixture(t);
  await fs.writeFile(path.join(directory, '.reg'), 'blocked');
  const details = 'Warning: Image failed.\nEssential recovery instructions';
  reporter.warning('image', details);
  assert.match(output[0], /Could not write capture log/);
  assert.equal(output[1], details);
  const error = new Error('Capture failed: Example\nHook: hooks/example\nFull details');
  reporter.failure(error);
  assert.equal(error.displayMessage, undefined);
  assert.match(formatError(error), /Full details/);
});

test('long log paths with spaces remain copyable in formatted errors', () => {
  const file = '/tmp/' + 'project with spaces/'.repeat(8) + 'capture.log';
  const rendered = formatError({ message: 'Full details', displayMessage: `Capture failed\nDetails: ${file}` }, { width: 40 });
  assert(rendered.includes(`\n  Details: ${file}\n`));
});

test('long page URLs and labels remain complete in warnings, retries and final errors', async t => {
  const { reporter, output } = await fixture(t);
  const url = 'https://example.test/' + 'long-page-path/'.repeat(25);
  const label = 'A long descriptive page label '.repeat(8).trim();
  reporter.warning('jpeg', `Some JPEG images could not be normalized. Page: ${url}. Example: https://images.example.test/resource.jpg`, { url });
  assert(output[0].startsWith(`Warning: ${url} — `));
  assert(!output[0].includes('Page:'), 'Do not repeat a truncated page URL in the explanation');
  reporter.retry({ url, scenarioLabel: label, viewportLabel: 'phone', attempt: 1, retries: 1,
    factor: 1, message: 'Hook: hooks/wait-for-fonts\nFonts did not become ready.' });
  assert(output[2].includes(url));
  assert(output[2].includes(label));
  const error = new Error(`Capture failed: ${label}\nPage URL: ${url}\nHook: hooks/wait-for-fonts\nFonts did not become ready.`);
  reporter.failure(error);
  const formatted = formatError(error, { width: 40 });
  assert(formatted.includes(`Page URL: ${url}\n`));
  assert(error.displayMessage.includes(label));
});

test('separate runs preserve their own logs even with identical timestamps', async t => {
  const { directory, reporter, output } = await fixture(t);
  const second = [];
  const other = createCaptureDiagnostics(directory, 'test', message => second.push(message));
  reporter.warning('first', 'First run');
  other.warning('second', 'Second run');
  assert.notEqual(output[1], second[1]);
  assert.equal((await fs.readdir(path.join(directory, '.reg/logs'))).length, 2);
});

test('single and worker captures log recovered retries, honor zero retries, and preserve references on failure', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  const counter = path.join(f.directory, 'attempts.txt');
  await fs.writeFile(path.join(f.directory, 'retry-hook.js'), `module.exports = async () => {
    const fs = require('node:fs'); const path = require('node:path');
    const file = path.join(__dirname, 'attempts.txt');
    const attempts = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;
    fs.writeFileSync(file, String(attempts + 1));
    if (attempts < 2) {
      const error = new Error('Temporary readiness failure\\nDetailed recovery instructions', { cause: new Error('Original fixture cause') });
      error.code = 'EAGLEDIFF_READY_TIMEOUT'; throw error;
    }
  };`);
  f.config.scenarios = [{ url: '/one', label: 'Example' }];
  f.config.onReadyScript = ['./retry-hook.js'];
  for (const workers of [1, 2]) {
    f.config.core.workers = workers;
    delete f.config.core.temporaryErrorRetries;
    await fs.rm(counter, { force: true }); await f.save();
    const recovered = await f.run(['reference']);
    assert.match(recovered.stderr, /retrying 1\/2/);
    assert.match(recovered.stderr, /retrying 2\/2/);
    assert.equal(recovered.stderr.split('\n').filter(Boolean).length, 3);
    assert(!recovered.stderr.includes('Detailed recovery instructions'));
    const details = require('./helpers/capture-log')(recovered.stderr);
    assert.match(details, /Detailed recovery instructions/);
    assert.match(details, /Original fixture cause/);
    assert.match(details, /retry-hook.js/);
    assert.equal(await fs.readFile(counter, 'utf8'), '3');
    const baselinePath = path.join(f.directory, '.reg/reference', (await f.files())[0]);
    const baseline = await fs.readFile(baselinePath);
    assert.equal(baseline.readUInt32BE(16), 100);
    assert.equal(baseline.readUInt32BE(20), 100);

    f.config.core.temporaryErrorRetries = 0;
    await fs.rm(counter); await f.save();
    const failed = await f.run(['reference'], 1);
    assert(!failed.stderr.includes('retrying'));
    assert.match(failed.stderr, /Capture failed.*Example @ small/);
    assert(!failed.stderr.includes('Detailed recovery instructions'));
    assert.match(require('./helpers/capture-log')(failed.stderr), /Original fixture cause/);
    assert.equal(await fs.readFile(counter, 'utf8'), '1');
    assert.deepEqual(await fs.readFile(baselinePath), baseline);
  }
});
