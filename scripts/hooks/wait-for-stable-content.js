module.exports = async function waitForStableContent(page, context) {
  const hookConfig = {
    ...normalizeHookConfig(context.config.defaults?.waitForStableContent),
    ...normalizeHookConfig(context.scenario.waitForStableContent)
  };
  const triggerSelectors = normalizeSelectors(
    hookConfig.triggerSelectors ||
      context.scenario.waitForTriggerSelectors ||
      context.config.defaults?.waitForTriggerSelectors ||
      []
  );
  const selectors = normalizeSelectors(
    hookConfig.selectors ||
      context.scenario.waitForSelectors ||
      context.config.defaults?.waitForSelectors ||
      []
  );
  const timeoutMs =
    hookConfig.timeout ||
    context.scenario.waitForTimeout ||
    context.config.defaults?.waitForTimeout ||
    15000;
  const settleDelayMs =
    hookConfig.settleDelayMs ||
    context.scenario.waitForSettleDelayMs ||
    context.config.defaults?.waitForSettleDelayMs ||
    750;

  if (!selectors.length) {
    return;
  }

  if (triggerSelectors.length) {
    const triggerIsPresent = await page.evaluate((currentTriggers) => {
      return currentTriggers.some((selector) => document.querySelector(selector));
    }, triggerSelectors);

    if (!triggerIsPresent) {
      return;
    }
  }
  else {
    const targetIsPresent = await page.evaluate((currentSelectors) => {
      return currentSelectors.some((selector) => document.querySelector(selector));
    }, selectors);

    if (!targetIsPresent) {
      return;
    }
  }

  await page.waitForFunction((currentSelectors) => {
    return currentSelectors.some((selector) => document.querySelector(selector));
  }, {
    timeout: timeoutMs,
    polling: 250
  }, selectors);

  await page.waitForFunction((currentSelectors, currentSettleDelayMs) => {
    const elements = currentSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)));

    if (!elements.length) {
      return false;
    }

    const visibleElements = elements.filter((element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (!visibleElements.length) {
      return false;
    }

    const signature = visibleElements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return [
          element.tagName,
          element.className || '',
          element.id || '',
          Math.round(rect.width),
          Math.round(rect.height),
          element.children.length,
          element.textContent ? element.textContent.length : 0
        ].join('|');
      })
      .join('||');

    const state = window.__regSuitStableContentState || (window.__regSuitStableContentState = {});
    const now = Date.now();

    if (state.signature !== signature) {
      state.signature = signature;
      state.seenAt = now;
      return false;
    }

    return now - state.seenAt >= currentSettleDelayMs;
  }, {
    timeout: timeoutMs,
    polling: 250
  }, selectors, settleDelayMs);
};

function normalizeSelectors(value) {
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry || '').split(','))
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function normalizeHookConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}
