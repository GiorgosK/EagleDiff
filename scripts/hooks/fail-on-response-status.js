module.exports = async function failOnResponseStatus(page, context) {
  const policy = resolveHttp404Policy(context.config, context.scenario);
  const status = Number(context.navigationResponseStatus);
  if (!Number.isFinite(status)) return;
  const label = context.scenario.label || context.scenario.url || 'scenario';
  const url = context.navigationResponseUrl || context.scenario.url || 'unknown-url';
  if (status === 404) {
    if (policy === 'error') throw new Error(`Blocked response status 404 for ${label} at ${url}`);
    const message = `Warning: HTTP 404 for ${label} at ${url}; continuing capture (http404Policy="warn").`;
    if (context.reportWarning) context.reportWarning(`http-404:${url}`, message);
    else require('../warnings').printWarning(message);
    return;
  }
  const errorCodes = normalizeCodes(
    context.scenario.failOnResponseStatusCodes ??
    context.config.defaults?.failOnResponseStatusCodes ??
    context.config.failOnResponseStatusCodes
  );

  if (errorCodes.length === 0) {
    return;
  }

  if (!errorCodes.includes(status)) {
    return;
  }

  throw new Error(`Blocked response status ${status} for ${label} at ${url}`);
};

function resolveHttp404Policy(config, scenario) {
  const policy = scenario.http404Policy ?? config.defaults?.http404Policy ?? 'warn';
  if (!['warn', 'error'].includes(policy)) throw new Error('http404Policy must be "warn" or "error".');
  return policy;
}

module.exports.resolveHttp404Policy = resolveHttp404Policy;

function normalizeCodes(value) {
  return Array.isArray(value)
    ? value.map(Number).filter(Number.isFinite)
    : [];
}
