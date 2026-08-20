const fsp = require('fs/promises');
const path = require('path');

const { rootDir } = require('./config-path');

async function main() {
  const pathsToRemove = [
    path.join(rootDir, '.reg'),
    path.join(rootDir, 'actual'),
    path.join(rootDir, 'reference')
  ];

  await Promise.all(pathsToRemove.map((targetPath) => fsp.rm(targetPath, { recursive: true, force: true })));

  console.log('[reg-suit] Cleaned .reg and legacy top-level caches');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
