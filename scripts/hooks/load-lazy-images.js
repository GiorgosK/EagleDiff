module.exports = async function loadLazyImages(page, context = {}) {
  const timeout = context.scenario?.lazyImageTimeout ?? context.config?.defaults?.lazyImageTimeout ?? 15000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('lazyImageTimeout must be a positive number.');

  await page.evaluate(async timeoutMs => {
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

    await Promise.all(Array.from(document.images).map(async image => {
      if (!image.getAttribute('src') && !image.srcset && !image.closest('picture')?.querySelector('source[srcset]')) return;
      let timer;
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
          })
        ]);
      } catch (error) {
        throw new Error(`Cannot load image before capture: ${image.src || image.currentSrc}\n${error.message}`);
      } finally {
        clearTimeout(timer);
      }
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, timeout).catch(error => {
    if (/Cannot load image before capture:[\s\S]*Timed out after \d+ms/.test(error.message)) {
      error.code = 'RSR_IMAGE_TIMEOUT';
    }
    throw error;
  });
};
