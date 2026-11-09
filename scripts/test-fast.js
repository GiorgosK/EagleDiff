const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tests = require('../tests/fast-tests.json');

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...tests], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit'
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
