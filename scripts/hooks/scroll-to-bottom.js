module.exports = async function scrollToBottom(page, context) {
  if (context.mode !== 'ready') {
    return;
  }

  const stepDelayMs = context.scenario.scrollStepDelayMs || context.config.defaults?.scrollStepDelayMs || 100;
  const settleDelayMs = context.scenario.scrollSettleDelayMs || context.config.defaults?.scrollSettleDelayMs || 300;
  const timeoutMs = context.scenario.scrollTimeout ?? context.config.defaults?.scrollTimeout ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('scrollTimeout must be a positive number.');

  await page.evaluate(async ({ stepDelay, settleDelay, timeout }) => {
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const stepSize = Math.max(1, Math.floor(viewportHeight / 2));
    const deadline = Date.now() + timeout;
    let position = 0;
    let reachedBottom = false;
    while (Date.now() < deadline) {
      position = Math.min(position + stepSize, Math.max(0, document.documentElement.scrollHeight - viewportHeight));
      window.scrollTo(0, position);
      await sleep(stepDelay);
      if (window.scrollY + viewportHeight >= document.documentElement.scrollHeight - 1) {
        await sleep(settleDelay);
        if (window.scrollY + viewportHeight >= document.documentElement.scrollHeight - 1) {
          reachedBottom = true;
          break;
        }
      }
    }

    window.scrollTo(0, 0);
    if (!reachedBottom) throw new Error(`Cannot finish lazy-content scroll within ${timeout}ms; page height keeps growing or scrolling is blocked.`);
    await sleep(settleDelay);
  }, {
    stepDelay: stepDelayMs,
    settleDelay: settleDelayMs,
    timeout: timeoutMs
  }).catch(error => {
    if (/Cannot finish lazy-content scroll within/.test(error.message)) error.code = 'EAGLEDIFF_SCROLL_TIMEOUT';
    throw error;
  });
};
