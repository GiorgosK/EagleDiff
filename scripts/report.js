const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { rootDir } = require('./config-path');
const { allReportPath } = require('./comparison-reports');

async function main() {
  const options = process.argv.slice(2).filter(arg => arg !== 'report');
  if (options.some(arg => arg !== '--all')) throw new Error('Usage: eaglediff report [--all]');
  const reportPath = await getReportPath(rootDir, options.includes('--all'));
  await openPath(reportPath);
}

async function getReportPath(root, all = false) {
  const reportPath = all ? await allReportPath(root) : path.join(root, '.reg', 'run', 'index.html');
  await fsp.access(reportPath);
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
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { getReportPath };
