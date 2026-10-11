module.exports = async function loadLazyImages(page, context = {}) {
  const timeout = context.scenario?.lazyImageTimeout ?? context.config?.defaults?.lazyImageTimeout ?? 15000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');
  const policy = context.scenario?.imageFailurePolicy ?? context.config?.defaults?.imageFailurePolicy ?? 'error';
  if (!['error', 'warn'].includes(policy)) throw new Error('imageFailurePolicy must be "error" or "warn".');

  const failures = await page.evaluate(async ({ timeoutMs, failurePolicy }) => {
    const promoteSources = () => {
      // Common lazy-loader attributes, independent of any particular library.
      for (const element of document.querySelectorAll('img, picture source')) {
        if (element instanceof HTMLImageElement) element.loading = 'eager';
        for (const attribute of ['sizes', 'srcset', 'src']) {
          if (element.tagName === 'SOURCE' && attribute === 'src') continue;
          const lazyAttribute = ['data-' + attribute, 'data-lazy-' + attribute]
            .find(name => element.getAttribute(name)?.trim());
          if (!lazyAttribute) continue;
          element.setAttribute(attribute, element.getAttribute(lazyAttribute));
          element.removeAttribute('data-' + attribute);
          element.removeAttribute('data-lazy-' + attribute);
        }
      }
    };
    promoteSources();
    await new Promise((resolve) => {
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
    // Scrolling can create additional image elements.
    promoteSources();

    const failures = [];
    await Promise.all(Array.from(document.images).map(async image => {
      if (!image.getAttribute('src') && !image.srcset && !image.closest('picture')?.querySelector('source[srcset]')) return;
      let timer;
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`Timed out after ${timeoutMs}ms`);
              error.code = 'RSR_IMAGE_TIMEOUT';
              reject(error);
            }, timeoutMs);
          })
        ]);
      } catch (error) {
        // A timeout leaves the image unresolved: it can still load and move
        // the layout during capture. Let the runner retry even in warning mode.
        if (failurePolicy === 'warn' && error.code !== 'RSR_IMAGE_TIMEOUT') {
          failures.push({ sources: [image.currentSrc, image.src].filter(Boolean), message: error.message });
          return;
        }
        throw new Error(`Cannot load image before capture: ${image.src || image.currentSrc}\n${error.message}`);
      } finally {
        clearTimeout(timer);
      }
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return failures;
  }, { timeoutMs: timeout, failurePolicy: policy }).catch(error => {
    if (/Cannot load image before capture:[\s\S]*Timed out after \d+ms/.test(error.message)) {
      error.code = 'RSR_IMAGE_TIMEOUT';
    }
    throw error;
  });
  context.failedImageSources = [...new Set(failures.flatMap(failure => failure.sources))];
  if (failures.length) {
    const safeUrl = source => {
      try { const url = new URL(source); return url.origin + url.pathname; } catch { return '(unknown image URL)'; }
    };
    const message = `Captured with ${failures.length} unresolved image(s) because imageFailurePolicy="warn". These may create visual differences. Page: ${safeUrl(page.url())}\n` +
      failures.slice(0, 5).map(failure => `  ${safeUrl(failure.sources[0])}: ${failure.message}`).join('\n');
    if (context.reportWarning) context.reportWarning(`image-load-failure:${safeUrl(page.url())}`, message);
    else console.warn(`[reg-suit] ${message}`);
  }
};
