// JavaScript animation libraries (GSAP, anime.js, Motion, hand-written
// requestAnimationFrame loops) animate elements by rewriting their inline
// style on every frame. Before the screenshot this hook:
//   1. waits until animations that started recently have finished, so an
//      entrance that began late is not captured half-way;
//   2. puts elements that keep moving (logo marquees, floating shapes) back at
//      their untransformed position with an !important rule, which wins over
//      the inline styles the script keeps writing;
//   3. removes will-change from script-animated elements: such a compositor
//      layer can keep the raster scale or text rendering of the transforms it
//      had during the animation, so the same final state could look slightly
//      different from one capture to the next.
const quietMs = 300; // no style change for this long: the element has settled
const endlessMs = 1500; // still changing after this long: treated as endless
const pollMs = 50;
const transformSelector = '[style*="transform"], [style*="translate"], [style*="rotate"], [style*="scale"]';

function resolveOptions(config = {}, scenario = {}) {
  const enabled = scenario.freezeScriptAnimations ?? config.defaults?.freezeScriptAnimations ?? true;
  if (typeof enabled !== 'boolean') throw new Error('freezeScriptAnimations must be a boolean.');
  const timeout = scenario.scriptAnimationTimeout ?? config.defaults?.scriptAnimationTimeout ?? 5000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('scriptAnimationTimeout must be a positive number of milliseconds.');
  return { enabled, timeout };
}

module.exports = async function freezeScriptAnimations(page, context = {}) {
  const { enabled, timeout } = resolveOptions(context.config, context.scenario);
  if (!enabled) return;
  const result = await page.evaluate(async (timeoutMs, quiet, endless, poll, selector) => {
    const changes = new Map(); // element -> { first, last } of its current run of style changes
    const observer = new MutationObserver(records => {
      const now = performance.now();
      for (const { target } of records) {
        const change = changes.get(target);
        if (change && now - change.last <= quiet) change.last = now;
        else changes.set(target, { first: now, last: now });
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
    const started = performance.now();
    let timedOut = false;
    try {
      while (true) {
        await new Promise(resolve => setTimeout(resolve, poll));
        const now = performance.now();
        if (now - started < quiet) continue;
        const active = [...changes.values()].filter(change => now - change.last <= quiet);
        if (!active.some(change => now - change.first < endless)) break;
        if (now - started >= timeoutMs) { timedOut = true; break; }
      }
    } finally {
      observer.disconnect();
    }
    const now = performance.now();
    const moving = [...changes].filter(([element, change]) => element.isConnected && now - change.last <= quiet)
      .map(([element]) => element).filter(element => element.matches(selector));
    const layered = [...document.querySelectorAll(selector)].filter(element => getComputedStyle(element).willChange !== 'auto');
    if (moving.length || layered.length) {
      if (!document.getElementById('eaglediff-script-animations')) {
        const style = document.createElement('style');
        style.id = 'eaglediff-script-animations';
        style.textContent = '[data-eaglediff-still]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}' +
          '[data-eaglediff-still],[data-eaglediff-flat]{will-change:auto!important}';
        document.head.append(style);
      }
      for (const element of moving) element.setAttribute('data-eaglediff-still', '');
      for (const element of layered) element.setAttribute('data-eaglediff-flat', '');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return { moving: moving.length, timedOut };
  }, timeout, quietMs, endlessMs, pollMs, transformSelector);
  if (result.timedOut) {
    const message = `Script animations were still starting after ${timeout}ms; the capture may differ between runs. ` +
      'Raise scriptAnimationTimeout, or set freezeScriptAnimations to false for this scenario.';
    if (context.reportWarning) context.reportWarning('script-animations-not-settled', message);
    else console.warn(`[eaglediff] ${message}`);
  }
  return result;
};
module.exports.resolveOptions = resolveOptions;
