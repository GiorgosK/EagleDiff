const fs = require('fs');
const os = require('os');
const path = require('path');
const { helperDir } = require('./config-path');

// Shared defaults for every project of a team or agency, merged over
// Eaglediff's config-default.json when a config is created, imported or
// updated. Project configs stay self-contained: commands that capture or
// compare read only the project config.
//
// Source, first match wins:
//   1. eaglediff --defaults <file>   (the CLI passes it as EAGLEDIFF_DEFAULTS)
//   2. EAGLEDIFF_DEFAULTS=<file>
//   3. $XDG_CONFIG_HOME/eaglediff/defaults.json or ~/.config/eaglediff/defaults.json
// An explicit file (1 or 2) must exist; the user file is optional.
// EAGLEDIFF_DEFAULTS=none turns agency defaults off.

const projectKeys = ['version', 'referenceBaseURL', 'testBaseURL', 'scenarios'];

function userDefaultsPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'eaglediff', 'defaults.json');
}

function agencyDefaultsPath(env = process.env) {
  const explicit = env.EAGLEDIFF_DEFAULTS;
  if (explicit === 'none') return null;
  if (explicit) {
    const resolved = path.resolve(env.EAGLEDIFF_INVOCATION_DIR || process.cwd(), explicit);
    if (!fs.existsSync(resolved)) throw new Error(`Defaults file not found: ${resolved}`);
    return resolved;
  }
  const user = userDefaultsPath(env);
  return fs.existsSync(user) ? user : null;
}

function readAgencyDefaults(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read defaults file ${file}: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(value)) throw new Error(`Defaults file ${file} must contain a JSON object.`);
  const misplaced = projectKeys.filter(key => Object.hasOwn(value, key));
  if (misplaced.length) {
    throw new Error(`Defaults file ${file} cannot set ${misplaced.join(', ')}; these belong in each project config.`);
  }
  return value;
}

// Objects merge key by key. Lists of text (selectors, hooks, extensions) keep
// Eaglediff's entries and add the agency's; other lists (viewports) and
// values replace Eaglediff's.
function mergeAgencyDefaults(base, agency) {
  if (Array.isArray(base) && Array.isArray(agency)) {
    const textList = [...base, ...agency].every(item => typeof item === 'string');
    return textList ? [...new Set([...base, ...agency])] : structuredClone(agency);
  }
  if (isPlainObject(base) && isPlainObject(agency)) {
    const result = { ...base };
    for (const [key, value] of Object.entries(agency)) {
      result[key] = Object.hasOwn(base, key) ? mergeAgencyDefaults(base[key], value) : structuredClone(value);
    }
    return result;
  }
  return structuredClone(agency);
}

// Eaglediff's defaults with the agency defaults applied, if any.
function loadDefaults(env = process.env) {
  const defaults = JSON.parse(fs.readFileSync(path.join(helperDir, 'config-default.json'), 'utf8'));
  const file = agencyDefaultsPath(env);
  return file ? mergeAgencyDefaults(defaults, readAgencyDefaults(file)) : defaults;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = { loadDefaults, mergeAgencyDefaults, agencyDefaultsPath, userDefaultsPath };
