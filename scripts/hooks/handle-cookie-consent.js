const applyPageStyles = require('../page-styles');
const { providers, bannerSelectors, resolveOptions } = require('../cookie-consent');

module.exports = async function handleCookieConsent(page, context = {}) {
  const { mode, timeout } = resolveOptions(context.config, context.scenario);
  if (mode === 'leave') return;
  if (mode === 'hide') {
    await applyPageStyles(page, `${bannerSelectors.join(',\n')} { display: none !important; }`, context.mode);
    return;
  }
  if (context.mode === 'before') return;
  const result = await page.evaluate(async ({ providers, timeout }) => {
    const visible = element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (['hidden', 'collapse'].includes(getComputedStyle(element).visibility)) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.opacity === '0') return false;
      }
      return true;
    };
    const clicked = new WeakSet();
    const accepted = new Set();
    const deadline = performance.now() + timeout;
    while (true) {
      const pending = [];
      for (const provider of providers) {
        const banners = provider.dialogs.flatMap(selector => [...document.querySelectorAll(selector)]).filter(visible);
        // Do not mistake an empty host or lingering underlay for an open dialog.
        const buttons = provider.accept.flatMap(selector => [...document.querySelectorAll(selector)]);
        if (!banners.length && !buttons.some(visible)) continue;
        pending.push(provider.name);
        const button = buttons.find(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
        if (button && !clicked.has(button)) {
          clicked.add(button);
          button.click();
          accepted.add(provider.name);
        }
      }
      if (accepted.size && !pending.length) return { accepted: [...accepted] };
      if (performance.now() >= deadline) return { pending, accepted: [...accepted] };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }, { providers, timeout });
  if (result.pending?.length) {
    const error = new Error(`Could not accept cookie consent within ${timeout}ms: ${result.pending.join(', ')}.\nNo supported accept-all button was available, or the banner stayed open after clicking.\nUse cookieConsent="hide" or "leave", or add a custom hook for this banner.`);
    error.code = 'EAGLEDIFF_COOKIE_CONSENT_TIMEOUT';
    throw error;
  }
};
