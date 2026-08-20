const fsp = require('fs/promises');
const path = require('path');

const { rootDir } = require('./config-path');

async function main() {
  const resultsPath = path.join(rootDir, 'results.json');
  const results = await readResults(resultsPath);

  if (!results.length) {
    throw new Error(`No results found in ${path.relative(rootDir, resultsPath)}`);
  }

  const [current, previous] = results;

  console.log(`[results] current  ${formatResultLine(current)}`);
  if (previous) {
    console.log(`[results] previous ${formatResultLine(previous)}`);
  }

  console.log('');
  console.log('[results] history');

  for (const entry of results.slice(0, 10).reverse()) {
    console.log(`[results] ${formatDateTime(entry.datetime)} ${renderBar(entry.passed, entry.run)} ${entry.passed}/${entry.run}`);
  }
}

async function readResults(resultsPath) {
  try {
    const raw = await fsp.readFile(resultsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function formatResultLine(entry) {
  return `${formatDateTime(entry.datetime)} | run=${entry.run} | passed=${entry.passed} | dur=${entry.dur_sec}s | workers=${entry.workers}`;
}

function renderBar(passed, total) {
  if (!total) {
    return '░░░░░░░░░░░░░░░░░░░░';
  }

  const width = 20;
  const filled = Math.round((passed / total) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function formatDateTime(datetime) {
  const value = String(datetime || '');
  const [datePart, timePartWithOffset] = value.split('T');
  if (!datePart || !timePartWithOffset) {
    return value;
  }

  const timePart = timePartWithOffset.replace(/\+.*$/, '').replace(/Z$/, '');
  return `${datePart.replace(/-/g, '/')} ${timePart}`;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
