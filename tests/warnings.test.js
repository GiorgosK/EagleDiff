const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWarningReporter } = require('../scripts/warnings');
const message = 'Warning: HTTP 404; continuing capture.';

function output({ terminal = false, env = {} } = {}) {
  const code = `process.stderr.isTTY = ${terminal}; const report = require(${JSON.stringify(path.resolve(__dirname, '../scripts/warnings'))}).createWarningReporter(); report('404', ${JSON.stringify(message)}); report('404', 'Duplicate');`;
  const childEnv = { ...process.env, TERM: 'xterm', ...env };
  if (!Object.hasOwn(env, 'NO_COLOR')) delete childEnv.NO_COLOR;
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: childEnv });
  assert.equal(result.status, 0);
  return result.stderr;
}

test('terminal output colors only the Warning label orange and still deduplicates messages', () => {
  assert.equal(output({ terminal: true }), '[eaglediff] \x1b[38;5;208mWarning:\x1b[0m HTTP 404; continuing capture.\n');
});

test('redirected output, NO_COLOR and dumb terminals keep warnings plain', () => {
  for (const options of [{}, { terminal: true, env: { NO_COLOR: '1' } }, { terminal: true, env: { TERM: 'dumb' } }]) {
    assert.equal(output(options), `[eaglediff] ${message}\n`);
  }
});

test('custom reporters keep uncolored messages for worker forwarding', () => {
  const forwarded = [];
  const report = createWarningReporter((message, code) => forwarded.push({ message, code }));
  report('404', message); report('404', 'Duplicate');
  assert.deepEqual(forwarded, [{ message, code: '404' }]);
});
