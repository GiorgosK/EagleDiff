function normalizeSelectors(value) {
  return (Array.isArray(value) ? value : [value])
    .map(selector => String(selector || '').trim()).filter(Boolean).join(',');
}

function resolveOptions(config = {}, scenario = {}) {
  const options = { ...config.defaults?.browserVerification, ...scenario.browserVerification };
  const challengeSelector = normalizeSelectors(options.challengeSelectors);
  const errorSelector = normalizeSelectors(options.errorSelectors);
  const timeout = options.timeout ?? 30000;
  const settleDelayMs = options.settleDelayMs ?? 500;
  if (challengeSelector && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new Error('browserVerification.timeout must be a positive number of milliseconds.');
  }
  if (challengeSelector && (!Number.isFinite(settleDelayMs) || settleDelayMs < 0)) {
    throw new Error('browserVerification.settleDelayMs must be a non-negative number of milliseconds.');
  }
  return { challengeSelector, errorSelector, timeout, settleDelayMs };
}

module.exports = async function waitForBrowserVerification(page, context) {
  const { challengeSelector, errorSelector, timeout, settleDelayMs } = resolveOptions(context.config, context.scenario);
  if (!challengeSelector) return;
  const deadline = Date.now() + timeout;
  let observed = false;
  let clearSince = null;
  let navigationCount = 0;
  let snapshot;
  let structure;
  let structureNavigation = -1;
  let phase = 'waiting for the initial document';
  const onNavigation = frame => {
    if (frame !== page.mainFrame()) return;
    navigationCount += 1;
    clearSince = null;
  };
  page.on('framenavigated', onNavigation);
  try {
    while (Date.now() < deadline) {
      let state;
      try {
        if (!structure || structureNavigation !== navigationCount) {
          await structure?.dispose();
          structure = await page.evaluateHandle(() => ({ roots: null }));
          structureNavigation = navigationCount;
        }
        state = await structure.evaluate((recorded, selector, failureSelector) => {
          const markers = document.querySelectorAll(selector);
          const visible = element => {
            if (!element.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(element).visibility)) return false;
            for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor);
              if (style.display === 'none' || style.opacity === '0') return false;
            }
            return true;
          };
          const contentRoots = () => [...(document.body?.children || [])].filter(element =>
            !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT'].includes(element.tagName) && visible(element));
          if (markers.length && recorded.roots === null) {
            // Keep element identities, not changing text or spinner markup. No HTML is written to disk.
            recorded.roots = contentRoots();
          }
          const structureReplaced = !!recorded.roots?.length &&
            recorded.roots.every(element => !element.isConnected) && contentRoots().length > 0 &&
            ![...markers].some(visible);
          return {
            readyState: document.readyState,
            title: document.title,
            markers: markers.length,
            structureReplaced,
            failed: !!markers.length && !!failureSelector && [...document.querySelectorAll(failureSelector)].some(visible)
          };
        }, challengeSelector, errorSelector);
      } catch (error) {
        // A verification redirect can replace the document during evaluation.
        // Browser disconnections and other protocol failures must reach recovery.
        if (!/Execution context was destroyed|Cannot find context with specified id|Argument should belong to the same JavaScript world as target object/.test(error.message) ||
            page.isClosed() || !page.browser().connected) throw error;
        await structure?.dispose();
        structure = null;
        clearSince = null;
        phase = 'waiting for a verification navigation';
      }
      if (state) {
        snapshot = state;
        if (Date.now() >= deadline) {
          observed ||= state.markers > 0;
          break;
        }
        if (state.failed) throw new Error(`Browser verification failed at ${page.url()}`);
        if (state.markers && !state.structureReplaced) {
          observed = true;
          clearSince = null;
          phase = 'waiting for the verification structure to disappear';
        } else if (state.readyState === 'loading') {
          clearSince = null;
          phase = observed ? 'waiting for the document after verification' : 'waiting for the initial document';
        } else {
          if (!observed) return;
          clearSince ??= Date.now();
          phase = 'checking that the verification structure stays absent';
          if (Date.now() - clearSince >= settleDelayMs) return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    let location = page.url();
    try { const url = new URL(location); location = url.origin + url.pathname; } catch { /* Keep non-HTTP locations. */ }
    const failure = observed ? 'Browser verification did not complete' : 'Document did not become ready';
    const error = new Error(`${failure} within ${timeout}ms at ${location}\n` +
      `Phase: ${phase}\nDocument: ${snapshot?.readyState ?? 'unavailable'}; title: ${snapshot?.title || '(empty)'}\n` +
      `Verification observed: ${observed}; remaining markers: ${snapshot?.markers ?? 'unknown'}; navigations: ${navigationCount}\n` +
      `Challenge selectors: ${challengeSelector}\n` +
      'Use a selector for the verification container, which disappears after success. Increase browserVerification.timeout for a slow automatic check; networkIdleTimeout runs later and does not extend this wait.');
    error.code = 'EAGLEDIFF_BROWSER_VERIFICATION_TIMEOUT';
    throw error;
  } finally {
    page.off('framenavigated', onNavigation);
    await structure?.dispose();
  }
};
module.exports.resolveOptions = resolveOptions;
