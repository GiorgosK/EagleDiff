module.exports = async function failOnResponseStatus(page, context) {
  const errorCodes = normalizeCodes(
    context.scenario.failOnResponseStatusCodes ??
    context.config.defaults?.failOnResponseStatusCodes ??
    context.config.failOnResponseStatusCodes
  );

  if (errorCodes.length === 0) {
    return;
  }

  const status = Number(context.navigationResponseStatus);
  if (!Number.isFinite(status)) {
    return;
  }

  if (!errorCodes.includes(status)) {
    return;
  }

  const label = context.scenario.label || context.scenario.url || 'scenario';
  const url = context.navigationResponseUrl || context.scenario.url || 'unknown-url';
  throw new Error(`Blocked response status ${status} for ${label} at ${url}`);
};

function normalizeCodes(value) {
  return Array.isArray(value)
    ? value.map(Number).filter(Number.isFinite)
    : [];
}
