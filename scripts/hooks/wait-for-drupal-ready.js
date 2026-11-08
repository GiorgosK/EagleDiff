const loadLazyImages = require('./load-lazy-images');

function resolveOptions(config = {}, scenario = {}) {
  const enabled = scenario.waitForDrupalReady ?? config.defaults?.waitForDrupalReady ?? true;
  const timeout = scenario.drupalReadyTimeout ?? config.defaults?.drupalReadyTimeout ?? 30000;
  if (typeof enabled !== 'boolean') throw new Error('waitForDrupalReady must be a boolean.');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('drupalReadyTimeout must be a positive number.');
  return { enabled, timeout };
}

// Observe real Drupal startup calls; never call attachBehaviors ourselves.
function observeDrupalStartup() {
  if (window.__eaglediffDrupalStartup) return;
  const attached = new WeakSet();
  const wrappers = [];
  const inspect = () => {
    const drupal = window.Drupal;
    if (!drupal || typeof drupal.attachBehaviors !== 'function') return;
    if (wrappers.some(entry => entry.wrapper === drupal.attachBehaviors)) return;
    const original = drupal.attachBehaviors;
    const wrapper = function (...args) {
      const fullDocument = !args[0] || args[0] === document;
      const behaviors = Object.values(drupal.behaviors || {})
        .map(behavior => behavior?.attach).filter(attach => typeof attach === 'function');
      const result = original.apply(this, args);
      if (fullDocument) for (const attach of behaviors) attached.add(attach);
      return result;
    };
    drupal.attachBehaviors = wrapper;
    if (drupal.attachBehaviors === wrapper) wrappers.push({ drupal, original, wrapper });
  };
  // Script load events and parser mutations run before later startup events.
  // No global Drupal setter or timers are needed on non-Drupal pages.
  document.addEventListener('load', inspect, true);
  document.addEventListener('DOMContentLoaded', inspect, true);
  const observer = new MutationObserver(inspect);
  observer.observe(document, { childList: true, subtree: true });
  window.__eaglediffDrupalStartup = {
    pending() {
      inspect();
      return Object.entries(window.Drupal?.behaviors || {})
        .filter(([, behavior]) => typeof behavior?.attach === 'function' && !attached.has(behavior.attach))
        .map(([name]) => name);
    },
    dispose() {
      this.disposed = true;
      observer.disconnect();
      document.removeEventListener('load', inspect, true);
      document.removeEventListener('DOMContentLoaded', inspect, true);
      for (const { drupal, original, wrapper } of wrappers) {
        if (drupal.attachBehaviors === wrapper) drupal.attachBehaviors = original;
      }
    }
  };
  inspect();
}

module.exports = async function waitForDrupalReady(page, context = {}) {
  const { enabled, timeout } = resolveOptions(context.config, context.scenario);
  if (!enabled) return;
  if (context.mode === 'before') {
    await page.evaluateOnNewDocument(observeDrupalStartup);
    return;
  }
  const result = await page.evaluate(async timeoutMs => {
    const monitor = window.__eaglediffDrupalStartup;
    if (!window.Drupal) { monitor?.dispose(); return {}; }
    if (!monitor) return { missingMonitor: true };
    if (monitor.disposed) return {};
    const images = () => JSON.stringify([...document.images].map(image =>
      [image.src, image.srcset, image.currentSrc, image.getAttribute('data-src'),
        image.getAttribute('data-srcset'), image.getAttribute('data-lazy-src'), image.getAttribute('data-lazy-srcset')]));
    const beforeImages = images();
    const deadline = performance.now() + timeoutMs;
    try {
      while (true) {
        const pending = monitor.pending();
        if (pending.length) {
          if (performance.now() >= deadline) return { pending };
          await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - performance.now()))));
        } else {
          // Let callbacks from the same startup task finish before checking again.
          await new Promise(resolve => setTimeout(resolve, 0));
          const late = monitor.pending();
          if (!late.length) return { imagesChanged: beforeImages !== images() };
          if (performance.now() >= deadline) return { pending: late };
        }
      }
    } finally {
      monitor.dispose();
    }
  }, timeout);
  if (result.missingMonitor) {
    throw new Error('Drupal startup tracking is missing. Add hooks/wait-for-drupal-ready to both onBeforeScript and onReadyScript, or remove it from both lists.');
  }
  if (result.pending) {
    const error = new Error(`Drupal startup did not attach ${result.pending.length} registered behavior(s) within ${timeout}ms:\n${result.pending.slice(0, 12).join(', ')}${result.pending.length > 12 ? ', ...' : ''}\nStartup scripts may have loaded after Drupal initialization. Check the site script/consent loading order. Use core.temporaryErrorRetries=1 for a fresh-page retry; increase drupalReadyTimeout for genuinely slow startup, or set waitForDrupalReady=false to disable this check.`);
    error.code = 'EAGLEDIFF_DRUPAL_READY_TIMEOUT';
    throw error;
  }
  if (result.imagesChanged) await loadLazyImages(page, context);
};

module.exports.resolveOptions = resolveOptions;
