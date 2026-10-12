const path = require('path');

const helperDir = path.resolve(
  process.env.EAGLEDIFF_SCRIPT_DIR
    || process.env.EAGLEDIFF_HELPER_DIR
    || path.resolve(__dirname, '..')
);

function resolveProjectDir() {
  const rawProjectDir = process.env.EAGLEDIFF_DIR
    || process.env.EAGLEDIFF_PROJECT_DIR
    || process.env.EAGLEDIFF_ROOT
    || process.env.npm_config_project_dir
    || process.env.npm_config_dir
    || process.cwd();

  return path.resolve(rawProjectDir);
}

const rootDir = resolveProjectDir();
const defaultConfigPath = path.join(rootDir, 'config.json');

function getConfigPath() {
  return process.env.GLOBAL_EAGLEDIFF_CONFIG
    || process.env.EAGLEDIFF_CONFIG
    || process.env.npm_config_config
    || defaultConfigPath;
}

module.exports = {
  helperDir,
  defaultConfigPath,
  getConfigPath,
  resolveProjectDir,
  rootDir
};
