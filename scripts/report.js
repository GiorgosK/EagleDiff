const reportError = require('./cli-error');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { rootDir } = require('./config-path');
const { allReportPath } = require('./comparison-reports');
const { referenceReportPath, readManifest } = require('./reference-report');

async function main() {
  const options = process.argv.slice(2).filter(arg => arg !== 'report');
  if (options.some(arg => !['--all', '--reference'].includes(arg)) || (options.includes('--all') && options.includes('--reference'))) {
    throw new Error('Usage: eaglediff report [--all | --reference]');
  }
  const reportPath = options.includes('--reference') ? await referenceReportPath(rootDir)
    : await getReportPath(rootDir, options.includes('--all'));
  await openPath(reportPath);
}

async function getReportPath(root, all = false) {
  if (all) return allReportPath(root);
  const reportPath = path.join(root, '.reg', 'run', 'index.html');
  let comparison;
  try { comparison = await fsp.stat(reportPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const references = await readManifest(root);
  if (!comparison || (references && Date.parse(references.completedAt) > comparison.mtimeMs)) return referenceReportPath(root);
  return reportPath;
}

function openPath(targetPath) {
  const platform = process.platform;
  const opener =
    platform === 'darwin'
      ? 'open'
      : platform === 'win32'
        ? 'cmd'
        : 'xdg-open';

  const args =
    platform === 'win32'
      ? ['/c', 'start', '', targetPath]
      : [targetPath];

  return new Promise((resolve, reject) => {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

if (require.main === module) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 1;
  });
}

module.exports = { getReportPath };
