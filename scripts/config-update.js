const fsp = require('fs/promises');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { compareVersions, versionParts } = require('./config-version');
const { getConfigPath, helperDir, rootDir } = require('./config-path');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Only absent keys are filled. Arrays and explicit null/false/empty values are overrides.
function fillMissing(current, defaults) {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(result, key)) {
      Object.defineProperty(result, key, {
        value: structuredClone(value), enumerable: true, writable: true, configurable: true
      });
    } else if (isObject(result[key]) && isObject(value)) {
      result[key] = fillMissing(result[key], value);
    }
  }
  return result;
}

function hookKey(hook) {
  return typeof hook === 'string' ? hook.replace(/^scripts\/hooks\//, 'hooks/').replace(/\.js$/, '') : hook;
}

function addMissingHooks(current, defaults) {
  // A string is a supported single-hook configuration; preserve explicit null/false.
  if (!Array.isArray(current) && typeof current !== 'string') return current;
  const result = Array.isArray(current) ? [...current] : [current];
  const defaultHooks = Array.isArray(defaults) ? defaults : [defaults];
  for (let index = 0; index < defaultHooks.length; index += 1) {
    const hook = defaultHooks[index];
    if (result.some(existing => hookKey(existing) === hookKey(hook))) continue;
    // Insert beside known default hooks without reordering any existing hooks.
    const next = defaultHooks.slice(index + 1)
      .map(candidate => result.findIndex(existing => hookKey(existing) === hookKey(candidate)))
      .find(position => position !== -1);
    if (next !== undefined) {
      result.splice(next, 0, hook);
    } else {
      const previous = defaultHooks.slice(0, index).reverse()
        .map(candidate => result.findIndex(existing => hookKey(existing) === hookKey(candidate)))
        .find(position => position !== -1);
      result.splice(previous === undefined ? result.length : previous + 1, 0, hook);
    }
  }
  return result;
}

function updateConfig(current, defaults) {
  if (!isObject(current) || !isObject(defaults)) throw new Error('Config must be a JSON object.');
  versionParts(defaults.version);
  if (Object.hasOwn(current, 'version') && compareVersions(current.version, defaults.version) > 0) {
    throw new Error(`Config version ${current.version} is newer than Eaglediff defaults ${defaults.version}. Update Eaglediff first.`);
  }
  const result = fillMissing(current, defaults);
  for (const key of ['onBeforeScript', 'onReadyScript']) {
    if (Object.hasOwn(current, key) && Object.hasOwn(defaults, key)) {
      result[key] = addMissingHooks(current[key], defaults[key]);
    }
  }
  result.version = defaults.version;
  return { version: result.version, ...result };
}

async function main() {
  const configPath = getConfigPath();
  const current = JSON.parse(await fsp.readFile(configPath, 'utf8'));
  const defaults = JSON.parse(await fsp.readFile(path.join(helperDir, 'config-default.json'), 'utf8'));
  const updated = updateConfig(current, defaults);
  if (Object.keys(current)[0] === 'version' && isDeepStrictEqual(current, updated)) {
    console.log(`[eaglediff] Config already up to date (${defaults.version})`);
    return;
  }
  await fsp.writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`[eaglediff] Updated ${path.relative(rootDir, configPath)} to ${defaults.version}; existing settings preserved`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { updateConfig };
