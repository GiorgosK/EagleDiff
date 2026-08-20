module.exports = async function waitUntilGone(page, context) {
  const selectors =
    context.scenario.waitUntilGone ||
    context.config.defaults?.waitUntilGone ||
    [];

  const timeoutMs =
    context.scenario.waitUntilGoneTimeout ||
    context.config.defaults?.waitUntilGoneTimeout ||
    10000;

  const list = Array.isArray(selectors) ? selectors : [selectors];
  const filtered = list.map((selector) => String(selector).trim()).filter(Boolean);

  if (!filtered.length) {
    return;
  }

  for (const selector of filtered) {
    await page.waitForFunction((currentSelector) => {
      const elements = Array.from(document.querySelectorAll(currentSelector));
      if (!elements.length) {
        return true;
      }

      return elements.every((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return true;
        }

        const rect = element.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0;
      });
    }, {
      timeout: timeoutMs
    }, selector);
  }
};
