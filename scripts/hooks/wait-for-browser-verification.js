module.exports = async function waitForBrowserVerification(page, context) {
  const options = {
    ...context.config.defaults?.browserVerification,
    ...context.scenario.browserVerification
  };
  const challengeSelector = normalizeSelectors(options.challengeSelectors);
  if (!challengeSelector) return;
  const errorSelector = normalizeSelectors(options.errorSelectors);
  const timeout = options.timeout ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('browserVerification.timeout must be a positive number of milliseconds.');
  }
  const state = await page.waitForFunction(selector => {
    if (document.readyState === 'loading') return false;
    return document.querySelector(selector) ? 'challenge' : 'ready';
  }, { timeout }, challengeSelector);
  const initialState = await state.jsonValue();
  await state.dispose();
  if (initialState === 'ready') return;

  let result;
  try {
    result = await page.waitForFunction((selector, failureSelector) => {
      if (document.readyState === 'loading') return false;
      if (!document.querySelector(selector)) return 'ready';
      const errors = failureSelector ? Array.from(document.querySelectorAll(failureSelector)) : [];
      if (errors.some(error => {
        const style = getComputedStyle(error);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && style.opacity !== '0' && error.getClientRects().length;
      })) {
        return 'failed';
      }
      return false;
    }, { timeout, polling: 100 }, challengeSelector, errorSelector);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    throw new Error(`Browser verification did not complete within ${timeout}ms at ${page.url()}`);
  }
  const finalState = await result.jsonValue();
  await result.dispose();
  if (finalState === 'failed') {
    throw new Error(`Browser verification failed at ${page.url()}`);
  }
};

function normalizeSelectors(value) {
  return (Array.isArray(value) ? value : [value])
    .map(selector => String(selector || '').trim())
    .filter(Boolean)
    .join(',');
}
