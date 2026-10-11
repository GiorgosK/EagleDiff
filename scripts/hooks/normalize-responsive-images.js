module.exports = async function normalizeResponsiveImages(page, context) {
  const selectorList =
    context.scenario.normalizeResponsiveImageSelectors ||
    context.config.defaults?.normalizeResponsiveImageSelectors ||
    ['img', 'picture source'];

  const selectors = Array.isArray(selectorList) ? selectorList : [selectorList];
  const filteredSelectors = selectors.map((selector) => String(selector).trim()).filter(Boolean);

  if (!filteredSelectors.length) {
    return;
  }

  await page.evaluate(async (currentSelectors, failedSources) => {
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const animationFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const elements = Array.from(document.querySelectorAll(currentSelectors.join(',')));
    const images = elements.filter((element) => element.tagName === 'IMG' &&
      !failedSources.includes(element.currentSrc) && !failedSources.includes(element.src));
    const sources = elements.filter((element) => element.tagName === 'SOURCE');

    for (const image of images) {
      const currentSource = image.currentSrc || image.getAttribute('src') || '';
      if (currentSource) {
        image.setAttribute('src', currentSource);
      }

      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.loading = 'eager';
    }

    for (const source of sources) {
      const image = source.closest('picture')?.querySelector('img');
      if (image && (failedSources.includes(image.currentSrc) || failedSources.includes(image.src))) continue;
      const srcset = source.getAttribute('srcset');
      if (!srcset) {
        continue;
      }

      const firstCandidate = srcset
        .split(',')
        .map((item) => item.trim())
        .find(Boolean);

      if (!firstCandidate) {
        continue;
      }

      const url = firstCandidate.split(/\s+/)[0];
      if (url) {
        source.setAttribute('srcset', url);
      }
    }

    const waitForDecode = async (image) => {
      try {
        if (image.decode) {
          await image.decode();
        }
      } catch (error) {
        // Ignore decode failures; the image may already be complete.
      }
    };

    await Promise.all(images.map(waitForDecode));
    await animationFrame();
    await sleep(50);
    await animationFrame();
  }, filteredSelectors, context.failedImageSources || []);
};
