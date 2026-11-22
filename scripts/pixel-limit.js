const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createRequire } = require('module');
const { helperDir } = require('./config-path');

// core.thresholdMaxPixels caps the pixels that may change, whatever the
// screenshot size. reg-cli accepts either a pixel count or a ratio, not both,
// so the comparison runs with thresholdRate and this step re-checks captures
// that passed although their pixels changed. Counting uses reg-cli's own
// img-diff-js with the same colour threshold, so counts match reg-cli's.

function validateMaxPixels(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('core.thresholdMaxPixels must be a whole number of pixels (0 or more), or null to disable it.');
  }
  return value;
}

// reg-cli is a dependency of reg-suit-core, a dependency of reg-suit.
function regCliRequire() {
  const fromHelper = createRequire(path.join(helperDir, 'package.json'));
  const fromRegSuit = createRequire(fromHelper.resolve('reg-suit/package.json'));
  const fromCore = createRequire(fromRegSuit.resolve('reg-suit-core/package.json'));
  return createRequire(fromCore.resolve('reg-cli/package.json'));
}

async function sameFile(first, second) {
  const [a, b] = await Promise.all([fsp.readFile(first), fsp.readFile(second)]);
  return a.equals(b);
}

// Moves captures that changed more than maxPixels from passed to failed, and
// rewrites out.json and the HTML report in workingDir. Returns the result.
async function applyPixelLimit(result, { workingDir, maxPixels, matchingThreshold }) {
  if (maxPixels === null || !result.passedItems.length) return result;
  const regCli = regCliRequire();
  const { imgDiff } = regCli('img-diff-js');
  const dirs = {
    actualDir: path.join(workingDir, 'actual'),
    expectedDir: path.join(workingDir, 'expected'),
    diffDir: path.join(workingDir, 'diff')
  };
  const exceeded = new Set();
  for (const item of result.passedItems) {
    const actual = path.join(dirs.actualDir, item);
    const expected = path.join(dirs.expectedDir, item);
    if (await sameFile(actual, expected)) continue;
    const { diffCount } = await imgDiff({
      actualFilename: actual,
      expectedFilename: expected,
      diffFilename: path.join(dirs.diffDir, item.replace(/\.[^.]+$/, '.png')),
      // reg-suit leaves enableAntialias off, so reg-cli counts antialiased pixels.
      options: { threshold: matchingThreshold, includeAA: true }
    });
    if (diffCount > maxPixels) exceeded.add(item);
  }
  if (!exceeded.size) return result;

  const updated = {
    ...result,
    passedItems: result.passedItems.filter(item => !exceeded.has(item)),
    failedItems: [...result.failedItems, ...exceeded].sort(),
    diffItems: [...new Set([...result.diffItems, ...exceeded])].sort()
  };
  const report = regCli('reg-cli/dist/report.js').default;
  return report({
    ...updated,
    ...dirs,
    json: path.join(workingDir, 'out.json'),
    report: fs.existsSync(path.join(workingDir, 'index.html')) ? path.join(workingDir, 'index.html') : '',
    junitReport: '',
    extendedErrors: false,
    urlPrefix: '',
    enableClientAdditionalDetection: true
  });
}

module.exports = { applyPixelLimit, validateMaxPixels };
