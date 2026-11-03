function resolveReadySelector(config, scenario) {
  // Keep the legacy root setting when defaults are blank. A scenario can
  // explicitly opt out of either inherited setting with an empty string.
  return scenario.readySelector ?? (config.defaults?.readySelector || config.readySelector || '');
}

module.exports = { resolveReadySelector };
