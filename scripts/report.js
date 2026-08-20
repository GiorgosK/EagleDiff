const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { rootDir } = require('./config-path');

async function main() {
  const reportPath = path.join(rootDir, '.reg', 'run', 'index.html');
  await fsp.access(reportPath);
  await openPath(reportPath);
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
    child.unref();
    resolve();
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
