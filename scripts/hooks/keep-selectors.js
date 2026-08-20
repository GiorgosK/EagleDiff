module.exports = async function keepSelectors(page, context) {
  const selectorList =
    context.scenario.keepSelectors ||
    context.config.defaults?.keepSelectors ||
    [];

  const selectors = Array.isArray(selectorList) ? selectorList : [selectorList];
  const filteredSelectors = selectors.map((selector) => String(selector).trim()).filter(Boolean);

  if (!filteredSelectors.length) {
    return;
  }

  const clip = await page.evaluate((currentSelectors) => {
    const rectangles = [];

    for (const selector of currentSelectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      if (!elements.length) {
        throw new Error(`keepSelectors selector not found: ${selector}`);
      }

      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          continue;
        }

        rectangles.push({
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          right: rect.right + window.scrollX,
          bottom: rect.bottom + window.scrollY
        });
      }
    }

    if (!rectangles.length) {
      return null;
    }

    const left = Math.floor(Math.min(...rectangles.map((rect) => rect.left)));
    const top = Math.floor(Math.min(...rectangles.map((rect) => rect.top)));
    const right = Math.ceil(Math.max(...rectangles.map((rect) => rect.right)));
    const bottom = Math.ceil(Math.max(...rectangles.map((rect) => rect.bottom)));

    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }, filteredSelectors);

  if (clip) {
    context.keepSelectorsClip = clip;
  }
};
