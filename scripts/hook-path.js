const path = require('node:path');

function hookKey(hook) {
  return typeof hook === 'string' ? hook.replace(/^scripts\/hooks\//, 'hooks/').replace(/\.js$/, '') : hook;
}

function resolveHookPath(spec, { helperDir, rootDir }) {
  const raw = String(spec);
  const normalized = path.isAbsolute(raw) || raw.startsWith('.') ? raw : hookKey(raw);
  const filename = normalized.endsWith('.js') ? normalized : normalized + '.js';
  if (path.isAbsolute(filename)) return filename;
  return path.join(raw.startsWith('.') ? rootDir : path.join(helperDir, 'scripts'), filename);
}

module.exports = { hookKey, resolveHookPath };
