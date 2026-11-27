const fs = require('fs');
const path = require('path');

// The release (package.json) and the default-settings revision
// (config-default.json "version", bumped only when defaults change).
function readVersions(dir = path.join(__dirname, '..')) {
  const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).version;
  return { release: read('package.json'), defaults: read('config-default.json') };
}

function describeVersions(dir) {
  const { release, defaults } = readVersions(dir);
  return `eaglediff ${release} (default settings ${defaults})`;
}

module.exports = { readVersions, describeVersions };
