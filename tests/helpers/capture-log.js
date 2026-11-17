const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = function readCaptureLog(output) {
  const match = output.match(/Details: (.+\.log)/);
  assert(match, 'Console output must point to the complete capture log');
  return fs.readFileSync(match[1], 'utf8');
};
