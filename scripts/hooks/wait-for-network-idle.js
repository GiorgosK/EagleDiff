module.exports = async function waitForNetworkIdle(page, context) {
  const timeoutMs = context.scenario.networkIdleTimeout || context.config.defaults?.networkIdleTimeout || 5000;
  const idleTimeMs = context.scenario.networkIdleTime || context.config.defaults?.networkIdleTime || 500;

  try {
    await page.waitForNetworkIdle({ idleTime: idleTimeMs, timeout: timeoutMs });
  } catch (error) {
    // Idle is best effort; disconnected browsers must reach capture recovery.
    if (error.name !== 'TimeoutError') throw error;
  }
};
