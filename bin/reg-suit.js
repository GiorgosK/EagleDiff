#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const defaultScriptDir = path.resolve(__dirname, '..');
const invocationDir = path.resolve(process.env.INIT_CWD || process.cwd());
const commands = new Set(['config', 'config-update', 'import', 'reference', 'test', 'approve', 'results', 'clean', 'report']);
const scriptByCommand = {
  config: 'scripts/config.js',
  'config-update': 'scripts/config-update.js',
  import: 'scripts/import.js',
  reference: 'scripts/run.js',
  test: 'scripts/run.js',
  approve: 'scripts/run.js',
  results: 'scripts/results.js',
  clean: 'scripts/clean.js',
  report: 'scripts/report.js'
};

function main() {
  const { command, projectDir, scriptDir, forwardedArgs } = parseArgs(process.argv.slice(2));

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const scriptName = scriptByCommand[command];
  if (!scriptName) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedScriptDir = resolveScriptDir(scriptDir);
  const resolvedProjectDir = resolveProjectDir(projectDir);
  ensureProjectDir(resolvedProjectDir);
  const childArgs = command === 'config' || command === 'config-update' || command === 'import'
    ? forwardedArgs
    : [command, ...forwardedArgs];
  const child = spawnSync(resolveNodeBinary(), [path.join(resolvedScriptDir, scriptName), ...childArgs], {
    cwd: resolvedProjectDir,
    env: {
      ...process.env,
      REG_SUIT_INVOCATION_DIR: invocationDir,
      REG_SUIT_SCRIPT_DIR: resolvedScriptDir,
      REG_SUIT_PROJECT_DIR: resolvedProjectDir,
      REG_SUIT_HELPER_DIR: resolvedScriptDir
    },
    stdio: 'inherit'
  });

  if (child.error) {
    throw child.error;
  }

  process.exitCode = child.status ?? 1;
}

function resolveScriptDir(scriptDir) {
  const candidate = scriptDir || process.env.REG_SUIT_SCRIPT_DIR;
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
  if (cwd === defaultScriptDir && !process.env.REG_SUIT_PROJECT_DIR && !process.env.REG_SUIT_ROOT && !process.env.REG_SUIT_DIR) {
    throw new Error('Refusing to use the shared helper directory as a project directory. Pass --dir or set REG_SUIT_DIR.');
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

function printUsage() {
  console.error('Usage: reg-suit-runner <config|config-update|import|reference|test|approve|results|clean|report> [--dir <project-dir>] [--script-dir <helper-dir>] [args...]');
}

Promise.resolve(main()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
