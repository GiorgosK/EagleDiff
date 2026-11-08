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

  let phase = 'waiting for matching content to appear';
  try {
    const matched = await page.waitForFunction((currentSelectors) => {
      return currentSelectors.some((selector) => document.querySelector(selector));
    }, {
      timeout: timeoutMs,
      polling: 250
    }, selectors);
    await matched.dispose();
    phase = 'waiting for visible content to settle';

    const settled = await page.waitForFunction((currentSelectors, currentSettleDelayMs) => {
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
    await settled.dispose();
  } catch (cause) {
    if (cause.name !== 'TimeoutError') throw cause;
    const targets = await page.evaluate(currentSelectors => currentSelectors.map(selector => {
      const matches = [...document.querySelectorAll(selector)];
      return { selector, count: matches.length, matches: matches.slice(0, 3).map(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          && rect.width > 0 && rect.height > 0;
        return `${element.tagName}${element.id ? '#' + element.id : ''}: ${visible ? 'visible' : 'hidden'}, ${Math.round(rect.width)}x${Math.round(rect.height)}, ${element.children.length} children, ${(element.textContent || '').length} text characters`;
      }) };
    }), selectors);
    const details = targets.slice(0, 8).map(target =>
      `${target.selector}: ${target.count ? target.matches.join('; ') : 'no matches'}${target.count > 3 ? `; ${target.count - 3} more matches` : ''}`);
    const failure = new Error(`Content did not become stable within ${timeoutMs}ms (${phase}).\n${details.join('\n')}\nVisible content must stay unchanged for ${settleDelayMs}ms. Check the widget's loading requests, increase waitForStableContent.timeout for slow content, or enable core.temporaryErrorRetries for a fresh-page retry.`, { cause });
    failure.code = 'EAGLEDIFF_STABLE_CONTENT_TIMEOUT';
    throw failure;
  }
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
