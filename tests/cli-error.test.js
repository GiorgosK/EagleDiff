const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { formatError } = require('../scripts/cli-error');

test('errors have spacing, readable lines, optional red headings, and intact URLs', () => {
  const url = 'https://example.test/' + 'long-image-name'.repeat(12) + '.jpg';
  const message = `Capture failed: Financial Information @ HD\nPage URL: https://example.test/about\nCannot load image before capture: ${url}\nImage network error: net::ERR_NETWORK_CHANGED.\npptr:evaluate;encoded-internal-location:61:15\nasync Promise.all (index 10)`;
  const plain = formatError(new Error(message), { width: 60 });
  assert(plain.startsWith('\nERROR:\n'));
  assert(plain.endsWith('\n\n'));
  assert(plain.includes(`\n  ${url}\n`));
  assert.match(plain, /\n  Image network error: net::ERR_NETWORK_CHANGED\./);
  assert(!plain.includes('\x1b'));
  assert(!plain.includes('pptr:evaluate'));
  assert(!plain.includes('async Promise.all'));
  const wrapped = formatError('This is a longer explanation with enough words to need multiple readable lines for a narrow terminal.', { width: 40 });
  assert(wrapped.trim().split('\n').every(line => line.length <= 42));
  assert.match(formatError('Failure', { color: true }), /\x1b\[31mERROR:\x1b\[0m/);
});

test('CLI argument errors use plain formatted errors and retain failing exit status', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/eaglediff.js'), '--dir', '/tmp', '--script-dir', '/missing-eaglediff', 'test'], {
    encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\nERROR:\n/);
  assert(!result.stderr.includes('\x1b'));
});

test('terminal errors use red and NO_COLOR disables it', () => {
  const code = `process.stderr.isTTY = true; process.stderr.columns = 80; require(${JSON.stringify(path.join(__dirname, '../scripts/cli-error'))})('Example failure');`;
  const env = { ...process.env, TERM: 'xterm' };
  delete env.NO_COLOR;
  const colored = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
  assert.equal(colored.status, 0);
  assert.match(colored.stderr, /\x1b\[31mERROR:\x1b\[0m/);
  const plain = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...env, NO_COLOR: '1' } });
  assert.equal(plain.status, 0);
  assert.equal(plain.stderr, '\nERROR:\n  Example failure\n\n');
});

test('unknown commands and child command validation use the same error format', () => {
  for (const args of [['unknown-command'], ['--dir', '/tmp', 'test', '--filter=page', '--last-failed']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/eaglediff.js'), ...args], {
      encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\nERROR:\n/);
    assert.match(result.stderr, args[0] === 'unknown-command' ? /Unknown command/ : /Use either --last-failed or --filter/);
  }
});
