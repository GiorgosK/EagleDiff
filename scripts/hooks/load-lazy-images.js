const withImageCaptureCheck = require('../image-capture-check');

module.exports = async function loadLazyImages(page, context = {}) {
  const timeout = context.scenario?.lazyImageTimeout ?? context.config?.defaults?.lazyImageTimeout ?? 15000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');
  const policy = context.scenario?.imageFailurePolicy ?? context.config?.defaults?.imageFailurePolicy ?? 'error';
  if (!['error', 'warn'].includes(policy)) throw new Error('imageFailurePolicy must be "error" or "warn".');
  const retryDownloads = context.scenario?.retryImageDownloads ?? context.config?.defaults?.retryImageDownloads ?? false;
  const downloadTimeout = context.scenario?.imageDownloadTimeout ?? context.config?.defaults?.imageDownloadTimeout ?? 15000;
  if (typeof retryDownloads !== 'boolean') throw new Error('retryImageDownloads must be a boolean.');
  if (!Number.isFinite(downloadTimeout) || downloadTimeout <= 0) throw new Error('imageDownloadTimeout must be a positive number.');

  const failures = await withImageCaptureCheck(page, check => page.evaluate(async ({ timeoutMs, failurePolicy, finalCheck, scrolled }, isExcluded) => {
    const promoted = new WeakMap();
    const promoteSources = ({ removeLazyAttributes = true } = {}) => {
      // Common lazy-loader attributes, independent of any particular library.
      for (const element of document.querySelectorAll('img, picture source')) {
        const image = element.tagName === 'IMG' ? element : element.closest('picture')?.querySelector('img');
        if (image && isExcluded(image) === 'display-none') continue;
        if (element instanceof HTMLImageElement) element.loading = 'eager';
        for (const attribute of ['sizes', 'srcset', 'src']) {
          if (element.tagName === 'SOURCE' && attribute === 'src') continue;
          const lazyAttribute = ['data-' + attribute, 'data-lazy-' + attribute]
            .find(name => element.getAttribute(name)?.trim());
          if (!lazyAttribute) continue;
          const value = element.getAttribute(lazyAttribute);
          const previous = promoted.get(element) || {};
          // Keep native responsive/source choices made during the scroll pass.
          if (previous[attribute] !== value && element.getAttribute(attribute) !== value) {
            element.setAttribute(attribute, value);
          }
          previous[attribute] = value;
          promoted.set(element, previous);
          if (removeLazyAttributes) {
            element.removeAttribute('data-' + attribute);
            element.removeAttribute('data-lazy-' + attribute);
          }
        }
      }
    };
    // Native loaders also use these attributes to initialize layout or handlers.
    // Keep them through the scroll pass, then consume any fallback sources below.
    promoteSources({ removeLazyAttributes: finalCheck });
    // scroll-to-bottom has already run lazy loaders for this capture; with
    // eager loading and promoted sources a second page scroll adds only time.
    if (!finalCheck && !scrolled) await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
    if (!finalCheck) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Scrolling can create additional image elements.
    promoteSources();

    const failures = [];
    await Promise.all(Array.from(document.images).map(async image => {
      if (isExcluded(image)) return;
      if (!image.getAttribute('src') && !image.srcset && !image.closest('picture')?.querySelector('source[srcset]')) return;
      let timer;
      try {
        await Promise.race([
          (async () => {
            const sourceState = () => JSON.stringify([image.src, image.currentSrc, image.srcset, image.sizes]);
            // Native lazy/responsive loaders can replace a source while decode()
            // is pending. Decode the replacement under the same timeout budget.
            for (let attempt = 0; ; attempt++) {
              const source = sourceState();
              try { await image.decode(); return; }
              catch (error) {
                const changing = source !== sourceState() || !image.complete || image.naturalWidth > 0;
                if (error.name !== 'EncodingError' || !changing || attempt >= 2) throw error;
                await new Promise(resolve => requestAnimationFrame(resolve));
              }
            }
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`Timed out after ${timeoutMs}ms`);
              error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
              reject(error);
            }, timeoutMs);
          })
        ]);
      } catch (error) {
        if (error.code === 'EAGLEDIFF_IMAGE_TIMEOUT') {
          failures.push({ sources: [image.currentSrc, image.src].filter(Boolean), message: error.message, timedOut: true });
          return;
        }
        // A timeout leaves the image unresolved: it can still load and move
        // the layout during capture. Let the runner retry even in warning mode.
        if (failurePolicy === 'warn' && error.code !== 'EAGLEDIFF_IMAGE_TIMEOUT') {
          failures.push({ sources: [image.currentSrc, image.src].filter(Boolean), message: error.message });
          return;
        }
        throw new Error(`Cannot load image before capture: ${image.currentSrc || image.src}\n${error.message}`);
      } finally {
        clearTimeout(timer);
      }
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return failures;
  }, { timeoutMs: timeout, failurePolicy: policy, finalCheck: context.imageReadinessFinalCheck === true,
    scrolled: context.scrolledToBottom === true }, check)).catch(error => {
    if (/Cannot load image before capture:[\s\S]*Timed out after \d+ms/.test(error.message)) {
      error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
    }
    throw error;
  });
  const timedOut = failures.filter(failure => failure.timedOut);
  if (timedOut.length) {
    const failure = timedOut[0];
    try {
      if (!retryDownloads) throw new Error(failure.message);
      await require('../recover-images')(page, timedOut, downloadTimeout);
    } catch (cause) {
      const error = new Error(`Cannot load image before capture: ${failure.sources[0]}\n${failure.message}\n${cause.message}`, { cause });
      error.code = 'EAGLEDIFF_IMAGE_TIMEOUT';
      throw error;
    }
    const pageUrl = new URL(page.url());
    const safePage = pageUrl.origin + pageUrl.pathname;
    const message = `Recovered ${timedOut.length} stalled image download(s) on the current page before capture. Page: ${safePage}`;
    if (context.reportWarning) context.reportWarning('image-download-recovered:' + safePage, message);
    else console.warn(`[eaglediff] ${message}`);
  }
  failures.splice(0, failures.length, ...failures.filter(failure => !failure.timedOut));
  context.failedImageSources = [...new Set(failures.flatMap(failure => failure.sources))];
  if (failures.length) {
    const safeUrl = source => {
      try { const url = new URL(source); return url.origin + url.pathname; } catch { return '(unknown image URL)'; }
    };
    const message = `Captured with ${failures.length} unresolved image(s) because imageFailurePolicy="warn". These may create visual differences. Page: ${safeUrl(page.url())}\n` +
      failures.slice(0, 5).map(failure => `  ${safeUrl(failure.sources[0])}: ${failure.message}`).join('\n');
    if (context.reportWarning) context.reportWarning(`image-load-failure:${safeUrl(page.url())}`, message);
    else console.warn(`[eaglediff] ${message}`);
  }
};
