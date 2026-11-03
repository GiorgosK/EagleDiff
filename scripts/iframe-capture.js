function resolveOptions(config, scenario) {
  const value = key => scenario[key] ?? config.defaults?.[key];
  const captureBeyondViewport = value('captureBeyondViewport') ?? 'auto';
  const waitForIframes = value('waitForIframes') ?? true;
  const iframeTimeout = value('iframeTimeout') ?? 30000;
  if (captureBeyondViewport !== 'auto' && typeof captureBeyondViewport !== 'boolean') {
    throw new Error('captureBeyondViewport must be "auto" or a boolean.');
  }
  if (typeof waitForIframes !== 'boolean') throw new Error('waitForIframes must be a boolean.');
  if (!Number.isFinite(iframeTimeout) || iframeTimeout <= 0) throw new Error('iframeTimeout must be a positive number.');
  return { captureBeyondViewport, waitForIframes, iframeTimeout };
}

async function prepareIframes(page, options) {
  if (!options.waitForIframes && options.captureBeyondViewport !== 'auto') return false;
  const deadline = Date.now() + options.iframeTimeout;
  let found = false;
  const visit = async frame => {
    for (const child of frame.childFrames()) {
      let element;
      let source;
      try {
        element = await child.frameElement();
        const state = await element.evaluate(iframe => {
          const box = iframe.getBoundingClientRect();
          if (box.width <= 1 || box.height <= 1 || iframe.clientWidth <= 1 || iframe.clientHeight <= 1) return null;
          const visibility = getComputedStyle(iframe).visibility;
          if (visibility === 'hidden' || visibility === 'collapse') return null;
          for (let ancestor = iframe; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.display === 'none' || style.opacity === '0') return null;
          }
          const source = iframe.getAttribute('src')?.trim();
          return { source: iframe.src, navigationExpected: !!source && !/^(about:blank|javascript:)/i.test(source) };
        });
        if (!state) continue;
        source = state.source;
        if (options.waitForIframes) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error('Iframe loading timed out.');
          const ready = await child.waitForFunction(navigationExpected =>
            document.readyState === 'complete' && (!navigationExpected || location.href !== 'about:blank'),
          { timeout: remaining, polling: 50 }, state.navigationExpected);
          await ready.dispose();
        }
        found = true;
        await visit(child);
      } catch (cause) {
        if (!page.isClosed() && page.browser().connected && child.detached) continue;
        if (cause.name === 'TimeoutError' || cause.message === 'Iframe loading timed out.') {
          const error = new Error(`Iframe did not finish loading within ${options.iframeTimeout}ms: ${source || child.url()}`, { cause });
          error.code = 'EAGLEDIFF_IFRAME_TIMEOUT';
          throw error;
        }
        throw cause;
      } finally {
        await element?.dispose();
      }
    }
  };
  await visit(page.mainFrame());
  return found;
}

module.exports = { resolveOptions, prepareIframes };
