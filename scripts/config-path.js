const path = require('path');

const helperDir = path.resolve(__dirname, '..');

function resolveProjectDir() {
  const rawProjectDir = process.env.REG_SUIT_PROJECT_DIR
    || process.env.REG_SUIT_ROOT
    || process.env.npm_config_project_dir
    || process.env.npm_config_dir
    || process.cwd();

  return path.resolve(rawProjectDir);
}

const rootDir = resolveProjectDir();
const defaultConfigPath = path.join(rootDir, 'config.json');

function getConfigPath() {
  return process.env.GLOBAL_REG_SUIT_CONFIG
    || process.env.REG_SUIT_CONFIG
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
