module.exports = async function waitForNetworkIdle(page, context) {
  const timeoutMs = context.scenario.networkIdleTimeout || context.config.defaults?.networkIdleTimeout || 5000;
  const idleTimeMs = context.scenario.networkIdleTime || context.config.defaults?.networkIdleTime || 500;

  try {
    await page.waitForNetworkIdle({ idleTime: idleTimeMs, timeout: timeoutMs });
  } catch (error) {
    // Ignore timeout; this is a best-effort stabilization step.
  }
};
