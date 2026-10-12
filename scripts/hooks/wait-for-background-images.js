module.exports = async function waitForBackgroundImages(page, context = {}) {
  const timeout = context.scenario?.lazyImageTimeout ?? context.config?.defaults?.lazyImageTimeout ?? 15000;
  const policy = context.scenario?.imageFailurePolicy ?? context.config?.defaults?.imageFailurePolicy ?? 'error';
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');
  if (!['error', 'warn'].includes(policy)) throw new Error('imageFailurePolicy must be "error" or "warn".');
  const failures = await page.evaluate(async ({ failedSources, timeout }) => {
    const images = [...document.images].filter(image =>
      (image.currentSrc || image.getAttribute('src') || image.srcset) && !failedSources.includes(image.currentSrc) && !failedSources.includes(image.src));
    const seen = new Set();
    for (const element of document.querySelectorAll('*')) {
      const background = getComputedStyle(element).backgroundImage;
      for (const match of background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)) {
        const source = match[1] ?? match[2] ?? match[3];
        if (seen.has(source)) continue;
        seen.add(source);
        const image = new Image(); image.src = source.trim(); images.push(image);
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
        return { source: image.currentSrc || image.src, timedOut: error.message === 'Image loading timed out.' };
      } finally { clearTimeout(timer); }
    }));
    return results.filter(Boolean);
  }, { failedSources: context.failedImageSources || [], timeout });
  for (const failure of failures) {
    const url = new URL(failure.source);
    const source = url.origin + url.pathname;
    const message = `Cannot load image before capture: ${source}` + (failure.timedOut ? `\nTimed out after ${timeout}ms` : '\nImage decoding failed.');
    if (failure.timedOut || policy === 'error') {
      const error = new Error(message);
      if (failure.timedOut) error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
      throw error;
    }
    if (context.reportWarning) context.reportWarning('background-image:' + source, message);
    else console.warn(`[eaglediff] ${message}`);
  }
};
