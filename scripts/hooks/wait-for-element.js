module.exports = async function waitForElement(page, context) {
  const selector =
    context.scenario.readySelector ||
    context.config.defaults?.readySelector ||
    context.config.readySelector;
  const timeoutMs =
    context.scenario.readyTimeout ||
    context.config.defaults?.readyTimeout ||
    context.config.readyTimeout ||
    10000;
  const visible =
    context.scenario.readyVisible ??
    context.config.defaults?.readyVisible ??
    false;

  if (!selector) {
    return;
  }

  const options = {
    timeout: timeoutMs
  };

  if (visible) {
    options.visible = true;
  }

  try {
    await page.waitForSelector(selector, options);
  } catch (error) {
    const failure = new Error(`Required readySelector ${JSON.stringify(selector)} was not found${visible ? ' or visible' : ''} within ${timeoutMs}ms at ${page.url()}. Check defaults.readySelector or the scenario override; increase readyTimeout only if the page needs more time. ${error.message}`, { cause: error });
    if (error.name === 'TimeoutError') failure.code = 'EAGLEDIFF_READY_TIMEOUT';
    throw failure;
  }
};
