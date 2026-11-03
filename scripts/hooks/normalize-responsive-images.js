const withImagePlaceholderCheck = require('../image-placeholder');

module.exports = async function normalizeResponsiveImages(page, context) {
  const timeout = context.scenario.lazyImageTimeout ?? context.config.defaults?.lazyImageTimeout ?? 15000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');
  const selectorList =
    context.scenario.normalizeResponsiveImageSelectors ||
    context.config.defaults?.normalizeResponsiveImageSelectors ||
    ['img', 'picture source'];

  const selectors = Array.isArray(selectorList) ? selectorList : [selectorList];
  const filteredSelectors = selectors.map((selector) => String(selector).trim()).filter(Boolean);

  if (!filteredSelectors.length) {
    return;
  }

  const failure = await withImagePlaceholderCheck(page, check => page.evaluate(async (currentSelectors, failedSources, timeout, isPlaceholder) => {
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const animationFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const elements = Array.from(document.querySelectorAll(currentSelectors.join(',')));
    const images = elements.filter((element) => element.tagName === 'IMG' &&
      !isPlaceholder(element) &&
      (element.currentSrc || element.getAttribute('src') || element.srcset) && !failedSources.includes(element.currentSrc) && !failedSources.includes(element.src));
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
      if (image && isPlaceholder(image)) continue;
      if (image && (failedSources.includes(image.currentSrc) || failedSources.includes(image.src))) continue;
      if (image && !images.includes(image)) {
        image.src = image.currentSrc || image.src;
        image.removeAttribute('srcset'); image.removeAttribute('sizes');
        images.push(image);
      }
      source.removeAttribute('srcset');
    }

    const failures = await Promise.all(images.map(async image => {
      let timer;
      try {
        await Promise.race([image.decode(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Responsive image timed out.')), timeout);
        })]);
        return null;
      } catch (error) {
        return { source: image.src, timedOut: error.message === 'Responsive image timed out.' };
      } finally { clearTimeout(timer); }
    }));
    const failure = failures.find(Boolean);
    if (failure) return failure;
    await animationFrame();
    await sleep(50);
    await animationFrame();
    return null;
  }, filteredSelectors, context.failedImageSources || [], timeout, check));
  if (failure) {
    const error = new Error(`Cannot decode responsive image before capture: ${failure.source}`);
    if (failure.timedOut) error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
    throw error;
  }
};
