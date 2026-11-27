const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { compareVersions } = require('./config-version');

function confirm(question) {
  return new Promise(resolve => {
    const input = readline.createInterface({ input: process.stdin, output: process.stderr });
    input.once('close', () => resolve(false));
    input.once('SIGINT', () => {
      input.close();
      process.exitCode = 130;
    });
    input.question(`${question} [y/N] `, answer => {
      resolve(/^y(es)?$/i.test(answer.trim()));
      input.close();
    });
  });
}

async function checkConfigVersion({ configPath, scriptDir, command, allowNewer = false }, {
  interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY),
  ask = confirm,
  warn = message => console.error(`[eaglediff] ${message}`)
} = {}) {
  // The explicit update command already validates versions and refuses downgrades.
  if (command === 'config-update') return true;
  let current;
  try {
    current = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw new Error(`Cannot read config ${configPath}: ${error.message}`, { cause: error });
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`Config must be a JSON object: ${configPath}`);
  }
  const defaults = JSON.parse(await fs.readFile(path.join(scriptDir, 'config-default.json'), 'utf8'));
  const comparison = Object.hasOwn(current, 'version') ? compareVersions(current.version, defaults.version) : -1;
  if (comparison === 0) return true;
  const relativePath = path.relative(process.env.INIT_CWD || process.cwd(), configPath);
  const release = JSON.parse(await fs.readFile(path.join(scriptDir, 'package.json'), 'utf8')).version;
  const versionDetails = [
    `  Config: ${relativePath}`,
    `  Config version:     ${current.version || 'unversioned'}`,
    `  Eaglediff defaults: ${defaults.version} (eaglediff ${release})`
  ].join('\n');
  if (comparison > 0) {
    warn(`Config is newer than this Eaglediff.\n${versionDetails}\n\n  The operation may be incompatible.\n`);
    if (allowNewer) return true;
    if (!interactive) {
      throw new Error('Cannot confirm in a non-interactive session. Update Eaglediff, or pass --allow-newer-config to continue explicitly.');
    }
    return ask('Continue with this newer config?');
  }
  warn(`Config is ${current.version ? 'older than this Eaglediff' : 'unversioned'}.\n${versionDetails}\n\n  Missing settings and hooks can be added with config-update.\n`);
  if (!interactive) {
    warn('Continuing without changes. Run config-update to add missing settings and hooks.');
    return true;
  }
  if (await ask('Update config.json with missing settings and hooks before continuing?')) {
    const { updateConfig } = require(path.join(scriptDir, 'scripts/config-update.js'));
    await fs.writeFile(configPath, `${JSON.stringify(updateConfig(current, defaults), null, 2)}\n`);
    warn(`Updated config to ${defaults.version}; existing settings preserved. Recalibrate references if needed.`);
  }
  return process.exitCode !== 130;
}

module.exports = { checkConfigVersion };
