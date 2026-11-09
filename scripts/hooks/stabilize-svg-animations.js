function resolveOptions(config = {}, scenario = {}) {
  const enabled = scenario.stabilizeSVGAnimations ?? config.defaults?.stabilizeSVGAnimations ?? true;
  const timeout = scenario.svgAnimationTimeout ?? config.defaults?.svgAnimationTimeout ?? 15000;
  if (typeof enabled !== 'boolean') throw new Error('stabilizeSVGAnimations must be a boolean.');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('svgAnimationTimeout must be a positive number.');
  return { enabled, timeout };
}

function describeEmbedding(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || ['hidden', 'collapse'].includes(getComputedStyle(element).visibility)) return null;
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') return null;
  }
  const source = element.getAttribute('data') || element.getAttribute('src') || '';
  return { source, expectedSVG: !!source && (element.getAttribute('type') === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(source)) };
}

function timeoutError(timeout, source, cause) {
  const error = new Error(`Cannot stabilize SVG animation within ${timeout}ms: ${source}\n${cause.message}`, { cause });
  error.code = 'EAGLEDIFF_SVG_ANIMATION_TIMEOUT';
  return error;
}

module.exports = async function stabilizeSVGAnimations(page, context = {}) {
  const { enabled, timeout } = resolveOptions(context.config, context.scenario);
  if (!enabled) return;
  const deadline = Date.now() + timeout;
  // An object's child frame may not exist yet at DOMContentLoaded.
  const embeddings = await page.$$('object[data],embed[src],iframe[src]');
  try {
    for (const element of embeddings) {
      const state = await element.evaluate(describeEmbedding);
      if (!state?.expectedSVG) continue;
      while (!await element.contentFrame()) {
        if (!await element.evaluate(node => node.isConnected)) break;
        if (Date.now() >= deadline) throw timeoutError(timeout, state.source, new Error('SVG document did not attach.'));
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  } finally { await Promise.all(embeddings.map(element => element.dispose())); }
  for (const frame of page.frames()) {
    let owner;
    try {
      let expectedSVG = frame === page.mainFrame();
      if (!expectedSVG) {
        owner = await frame.frameElement();
        const state = await owner.evaluate(describeEmbedding);
        if (!state) continue;
        expectedSVG = state.expectedSVG;
        const svgDocument = await frame.evaluate(() => document.documentElement?.namespaceURI === 'http://www.w3.org/2000/svg');
        if (!expectedSVG && !svgDocument) continue;
        if (expectedSVG) {
          const ready = await frame.waitForFunction(() => document.readyState === 'complete' &&
            document.documentElement?.namespaceURI === 'http://www.w3.org/2000/svg',
          { timeout: Math.max(1, deadline - Date.now()), polling: 50 });
          await ready.dispose();
        }
      }
      const result = await frame.evaluate(async timeoutMs => {
        const svgs = [...document.querySelectorAll('svg')];
        let timer;
        try {
          return await Promise.race([
            Promise.all(svgs.map(async svg => {
              for (let node = svg; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') return;
              }
              if (svg.querySelector('animate,animateMotion,animateTransform,set')) {
                svg.pauseAnimations(); svg.setCurrentTime(0);
              }
              const player = svg.svgatorPlayer;
              if (!player || typeof player.stop !== 'function') return;
              if (typeof player.ready === 'function') await new Promise(resolve => player.ready(resolve));
              player.stop();
            })).then(() => null),
            new Promise(resolve => { timer = setTimeout(() => resolve('SVG player did not become ready.'), timeoutMs); })
          ]);
        } finally { clearTimeout(timer); }
      }, Math.max(1, deadline - Date.now()));
      if (result) {
        const error = new Error(result); error.name = 'TimeoutError'; throw error;
      }
    } catch (cause) {
      if (!page.isClosed() && page.browser().connected && frame.detached) continue;
      if (cause.name === 'TimeoutError') {
        throw timeoutError(timeout, frame.url(), cause);
      }
      throw cause;
    } finally { await owner?.dispose(); }
  }
};
module.exports.resolveOptions = resolveOptions;
