#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const helperDir = path.resolve(__dirname, '..');
const invocationDir = path.resolve(process.env.INIT_CWD || process.cwd());
const commands = new Set(['config', 'reference', 'test', 'approve', 'results', 'clean', 'report']);
const scriptByCommand = {
  config: 'scripts/config.js',
  reference: 'scripts/run.js',
  test: 'scripts/run.js',
  approve: 'scripts/run.js',
  results: 'scripts/results.js',
  clean: 'scripts/clean.js',
  report: 'scripts/report.js'
};

function main() {
  const { command, projectDir, forwardedArgs } = parseArgs(process.argv.slice(2));

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

  const resolvedProjectDir = resolveProjectDir(projectDir);
  const childArgs = command === 'config'
    ? forwardedArgs
    : [command, ...forwardedArgs];
  const child = spawnSync(resolveNodeBinary(), [path.join(helperDir, scriptName), ...childArgs], {
    cwd: resolvedProjectDir,
    env: {
      ...process.env,
      REG_SUIT_PROJECT_DIR: resolvedProjectDir,
      REG_SUIT_HELPER_DIR: helperDir
    },
    stdio: 'inherit'
  });

  if (child.error) {
    throw child.error;
  }

  process.exitCode = child.status ?? 1;
}

function resolveProjectDir(projectDir) {
  if (projectDir) {
    return path.resolve(invocationDir, projectDir);
  }

  const cwd = invocationDir;
  if (cwd === helperDir && !process.env.REG_SUIT_PROJECT_DIR && !process.env.REG_SUIT_ROOT) {
    throw new Error('Refusing to use the shared helper directory as a project directory. Pass --project-dir or set REG_SUIT_PROJECT_DIR.');
  }

  return cwd;
}

function resolveNodeBinary() {
  return process.env.npm_node_execpath || 'node';
}

function parseArgs(argv) {
  let command = null;
  let projectDir = null;
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

    if (arg === '--project-dir' || arg === '--projectDir' || arg === '--dir' || arg === '-C') {
      projectDir = argv[i + 1];
      i += 1;
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

    if (arg.startsWith('--dir=')) {
      projectDir = arg.slice('--dir='.length);
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
    forwardedArgs
  };
}

function printUsage() {
  console.error('Usage: reg-suit-runner <config|reference|test|approve|results|clean|report> [--project-dir <path>] [args...]');
}

Promise.resolve(main()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
