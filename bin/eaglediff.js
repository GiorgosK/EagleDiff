#!/usr/bin/env node

const reportError = require('../scripts/cli-error');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const defaultScriptDir = path.resolve(__dirname, '..');
const invocationDir = path.resolve(process.env.INIT_CWD || process.cwd());
const commands = new Set(['config', 'config-update', 'import', 'reference', 'test', 'calibrate', 'approve', 'results', 'clean', 'report']);
const scriptByCommand = {
  config: 'scripts/config.js',
  'config-update': 'scripts/config-update.js',
  import: 'scripts/import.js',
  reference: 'scripts/run.js',
  test: 'scripts/run.js',
  calibrate: 'scripts/run.js',
  approve: 'scripts/run.js',
  results: 'scripts/results.js',
  clean: 'scripts/clean.js',
  report: 'scripts/report.js'
};

async function main() {
  const { command, projectDir, scriptDir, forwardedArgs } = parseArgs(process.argv.slice(2));

  if (command === 'help' || forwardedArgs.some(arg => arg === '--help' || arg === '-h')) {
    printUsage(console.log);
    return;
  }

  if (!command) {
    reportError('No command specified.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const scriptName = scriptByCommand[command];
  if (!scriptName) {
    reportError(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedScriptDir = resolveScriptDir(scriptDir);
  const resolvedProjectDir = resolveProjectDir(projectDir);
  const configPath = path.resolve(resolvedProjectDir,
    process.env.GLOBAL_EAGLEDIFF_CONFIG || process.env.EAGLEDIFF_CONFIG
      || process.env.npm_config_config || path.join(process.env.EAGLEDIFF_DIR || resolvedProjectDir, 'config.json'));
  const allowNewer = forwardedArgs.includes('--allow-newer-config');
  const operationArgs = forwardedArgs.filter(arg => arg !== '--allow-newer-config');
  const { checkConfigVersion } = require('../scripts/check-config-version');
  if (!await checkConfigVersion({ configPath, scriptDir: resolvedScriptDir, command, allowNewer })) {
    reportError('Operation cancelled.');
    process.exitCode = process.exitCode || 1;
    return;
  }
  ensureProjectDir(resolvedProjectDir);
  const childArgs = command === 'config' || command === 'config-update' || command === 'import'
    ? operationArgs
    : [command, ...operationArgs];
  const scriptPath = path.join(resolvedScriptDir, scriptName);
  if (!fs.existsSync(scriptPath)) throw new Error(`Command script not found:\n${scriptPath}\nCheck --script-dir or your Eaglediff installation.`);
  const child = spawnSync(resolveNodeBinary(), [scriptPath, ...childArgs], {
    cwd: resolvedProjectDir,
    env: {
      ...process.env,
      EAGLEDIFF_INVOCATION_DIR: invocationDir,
      EAGLEDIFF_SCRIPT_DIR: resolvedScriptDir,
      EAGLEDIFF_PROJECT_DIR: resolvedProjectDir,
      EAGLEDIFF_HELPER_DIR: resolvedScriptDir
    },
    stdio: 'inherit'
  });

  if (child.error) {
    throw child.error;
  }

  process.exitCode = child.status ?? 1;
}

function resolveScriptDir(scriptDir) {
  const candidate = scriptDir || process.env.EAGLEDIFF_SCRIPT_DIR;
  if (candidate) {
    return path.resolve(invocationDir, candidate);
  }

  return defaultScriptDir;
}

function resolveProjectDir(projectDir) {
  if (projectDir) {
    return path.resolve(invocationDir, projectDir);
  }

  const cwd = invocationDir;
  if (cwd === defaultScriptDir && !process.env.EAGLEDIFF_PROJECT_DIR && !process.env.EAGLEDIFF_ROOT && !process.env.EAGLEDIFF_DIR) {
    throw new Error('Refusing to use the shared helper directory as a project directory. Pass --dir or set EAGLEDIFF_DIR.');
  }

  return cwd;
}

function resolveNodeBinary() {
  return process.env.npm_node_execpath || process.execPath || 'node';
}

function ensureProjectDir(projectDir) {
  if (!projectDir) {
    return;
  }

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
}

function parseArgs(argv) {
  let command = null;
  let projectDir = null;
  let scriptDir = null;
  const forwardedArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      if (!command && forwardedArgs.length === 0) {
        continue;
      }
      forwardedArgs.push(...argv.slice(i + 1));
      break;
    }

    if (arg === '--dir' || arg === '--project-dir' || arg === '--projectDir' || arg === '-C') {
      projectDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--script-dir' || arg === '--scriptDir' || arg === '--script-path') {
      scriptDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--dir=')) {
      projectDir = arg.slice('--dir='.length);
      continue;
    }

    if (arg.startsWith('--project-dir=')) {
      projectDir = arg.slice('--project-dir='.length);
      continue;
    }

    if (arg.startsWith('--projectDir=')) {
      projectDir = arg.slice('--projectDir='.length);
      continue;
    }

    if (arg.startsWith('--script-dir=')) {
      scriptDir = arg.slice('--script-dir='.length);
      continue;
    }

    if (arg.startsWith('--scriptDir=')) {
      scriptDir = arg.slice('--scriptDir='.length);
      continue;
    }

    if (arg.startsWith('--script-path=')) {
      scriptDir = arg.slice('--script-path='.length);
      continue;
    }

    if (arg.startsWith('-C=')) {
      projectDir = arg.slice(3);
      continue;
    }

    if (!command && commands.has(arg)) {
      command = arg;
      continue;
    }

    if (!command && !arg.startsWith('-')) {
      command = arg;
      continue;
    }

    forwardedArgs.push(arg);
  }

  return {
    command,
    projectDir,
    scriptDir,
    forwardedArgs
  };
}

function printUsage(write = console.error) {
  write(`Usage: eaglediff [--dir <project-dir>] <command> [options]

Run inside the folder containing config.json, or add --dir tests/eaglediff.

Commands and examples:
  eaglediff config --ref=https://example.com            Discover pages and create or extend config.json.
  eaglediff config-update                                   Add missing settings/hooks; preserve existing values.
  eaglediff import --backstop=/path/to/backstop             Import scenarios and settings from Backstop.
  eaglediff reference                                       Capture reference screenshots, replacing the baseline.
  eaglediff calibrate                                       Compare references with fresh captures of the reference site.
  eaglediff test --filter=homepage --workers=3              Capture matching pages and compare with references.
  eaglediff test --last-failed                              Retest the last comparison's failed pages.
  eaglediff reference --last-failed                         Replace references for those pages only.
  eaglediff approve                                         Replace references with the latest captures after review.
  eaglediff results                                         Show recent pass counts, timings, and run history.
  eaglediff report                                          Open the latest comparison or reference capture gallery.
  eaglediff report --reference                              Browse current reference screenshots without comparing.
  eaglediff report --all                                    Show the latest saved result for every available screenshot.
  eaglediff clean                                           Delete screenshots, references, reports, and legacy caches.
  eaglediff help                                            Show this help (also --help or -h).

Options:
  --dir <path>         Project folder; defaults to the current directory.
  --script-dir <path>  Use scripts from another Eaglediff checkout.
  --filter <text>      Match scenario labels or URLs for reference/test/calibrate.
  --last-failed        Select failed pages from the latest comparison (reference/test/calibrate).
  --reference          Browse reference captures (report only).
  --all                Show all available results (report only).
  --workers <count>    Limit concurrent captures; overrides core.workers.
  --no-clean          Keep cached screenshots for reference/test/calibrate.
  --allow-newer-config  Continue with a config newer than this Eaglediff without prompting.`);
}

Promise.resolve(main()).catch((error) => {
  reportError(error);
  process.exitCode = 1;
});
