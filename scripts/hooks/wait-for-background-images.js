const withImageCaptureCheck = require('../image-capture-check');

module.exports = async function waitForBackgroundImages(page, context = {}) {
  const timeout = context.scenario?.lazyImageTimeout ?? context.config?.defaults?.lazyImageTimeout ?? 15000;
  const policy = context.scenario?.imageFailurePolicy ?? context.config?.defaults?.imageFailurePolicy ?? 'error';
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');
  if (!['error', 'warn'].includes(policy)) throw new Error('imageFailurePolicy must be "error" or "warn".');
  const failures = await withImageCaptureCheck(page, check => page.evaluate(async ({ failedSources, timeout }, isExcluded) => {
    const describe = isExcluded.describe;
    const owners = new Map();
    const images = [...document.images].filter(image =>
      !isExcluded(image) &&
      (image.currentSrc || image.getAttribute('src') || image.srcset) && !failedSources.includes(image.currentSrc) && !failedSources.includes(image.src));
    for (const image of images) owners.set(image, describe(image));
    const seen = new Set();
    const canPaintBackground = (element, elementStyle) => {
      // Root/body backgrounds can paint the canvas even without a layout box.
      if (element === document.documentElement || element === document.body) return true;
      const visibility = elementStyle.visibility;
      if (visibility === 'hidden' || visibility === 'collapse') return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = ancestor === element ? elementStyle : getComputedStyle(ancestor);
        if (style.display === 'none' || style.opacity === '0') return false;
        // content-visibility hides descendants, but the owner's background paints.
        if (ancestor !== element && style.contentVisibility === 'hidden') return false;
      }
      return true;
    };
    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const background = style.backgroundImage;
      if (!background.includes('url(') || !canPaintBackground(element, style)) continue;
      for (const match of background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)) {
        const source = (match[1] ?? match[2] ?? match[3]).trim();
        // An empty url() loads nothing in the browser; as an image source it
        // would resolve to the page URL and fail as a broken image.
        if (!source || seen.has(source)) continue;
        seen.add(source);
        const image = new Image(); image.src = source; images.push(image);
        owners.set(image, describe(element) + ' (background-image)');
      }
    }
    const results = await Promise.all(images.map(async image => {
      let timer;
      try {
        await Promise.race([image.decode(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Image loading timed out.')), timeout);
        })]);
        if (!image.naturalWidth) throw new Error('Image has no decoded pixels.');
        return null;
      } catch (error) {
        return { source: image.currentSrc || image.src, element: owners.get(image),
          timedOut: error.message === 'Image loading timed out.' };
      } finally { clearTimeout(timer); }
    }));
    return results.filter(Boolean);
  }, { failedSources: context.failedImageSources || [], timeout }, check));
  for (const failure of failures) {
    const url = new URL(failure.source);
    const source = url.origin + url.pathname;
    const message = `Cannot load image before capture: ${source}` +
      (failure.element ? `\nElement: ${failure.element}` : '') +
      (failure.timedOut ? `\nTimed out after ${timeout}ms` : '\nImage decoding failed.');
    if (failure.timedOut || policy === 'error') {
      const error = new Error(message);
      if (failure.timedOut) error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
      throw error;
    }
    if (context.reportWarning) context.reportWarning('background-image:' + source, message);
    else console.warn(`[eaglediff] ${message}`);
  }
};
