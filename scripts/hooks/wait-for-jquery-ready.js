const loadLazyImages = require('./load-lazy-images');

function resolveOptions(config = {}, scenario = {}) {
  const enabled = scenario.waitForJQueryReady ?? config.defaults?.waitForJQueryReady ?? true;
  const timeout = scenario.jqueryReadyTimeout ?? config.defaults?.jqueryReadyTimeout ?? 30000;
  if (typeof enabled !== 'boolean') throw new Error('waitForJQueryReady must be a boolean.');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('jqueryReadyTimeout must be a positive number.');
  return { enabled, timeout };
}

module.exports = async function waitForJQueryReady(page, context = {}) {
  const { enabled, timeout } = resolveOptions(context.config, context.scenario);
  if (!enabled) return;
  const result = await page.evaluate(async timeoutMs => {
    let timer;
    let onDomReady;
    let phase = 'DOMContentLoaded';
    const images = () => JSON.stringify([...document.images].map(image =>
      [image.src, image.srcset, image.currentSrc, image.getAttribute('data-src'),
        image.getAttribute('data-srcset'), image.getAttribute('data-lazy-src'), image.getAttribute('data-lazy-srcset')]));
    const beforeImages = images();
    // Only observe startup. Do not release holds, attach behaviors, or hide UI.
    const ready = async () => {
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          onDomReady = resolve;
          document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
        });
      }
      const jquery = window.jQuery;
      if (typeof jquery === 'function' && typeof jquery.fn?.ready === 'function') {
        phase = 'jQuery ready callbacks (startup may still be on hold)';
        await new Promise(resolve => jquery(document).ready(resolve));
      }
      phase = 'rendering after startup';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { imagesChanged: beforeImages !== images() };
    };
    try {
      return await Promise.race([
        ready(),
        new Promise(resolve => {
          timer = setTimeout(() => resolve({ failure: `Page startup did not finish within ${timeoutMs}ms. Waiting for: ${phase}. Check startup scripts, increase jqueryReadyTimeout, or disable waitForJQueryReady for this page.` }), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (onDomReady) document.removeEventListener('DOMContentLoaded', onDomReady);
    }
  }, timeout);
  if (result.failure) {
    const error = new Error(result.failure);
    error.code = 'EAGLEDIFF_JQUERY_READY_TIMEOUT';
    throw error;
  }
  // Initialization can introduce more lazy images after the first image pass.
  // Keep subsequent responsive/decoding/background hooks on the final sources.
  if (result.imagesChanged) await loadLazyImages(page, context);
};

module.exports.resolveOptions = resolveOptions;
