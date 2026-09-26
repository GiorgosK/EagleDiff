const fsp = require('fs/promises');

async function readResults(filePath) {
  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!raw.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot read results history ${filePath}: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid results history ${filePath}: expected a JSON array.`);
  }
  return parsed;
}

module.exports = { readResults };
