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

  await page.waitForSelector(selector, options);
};
