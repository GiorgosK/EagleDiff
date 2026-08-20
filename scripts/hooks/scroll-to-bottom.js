module.exports = async function scrollToBottom(page, context) {
  if (context.mode !== 'ready') {
    return;
  }

  const stepDelayMs = context.scenario.scrollStepDelayMs || context.config.defaults?.scrollStepDelayMs || 100;
  const settleDelayMs = context.scenario.scrollSettleDelayMs || context.config.defaults?.scrollSettleDelayMs || 300;

  await page.evaluate(async ({ stepDelay, settleDelay }) => {
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const scrollHeight = document.documentElement.scrollHeight;
    const steps = Math.max(1, Math.ceil(scrollHeight / viewportHeight));

    for (let step = 1; step <= steps; step += 1) {
      window.scrollTo(0, step * viewportHeight);
      await sleep(stepDelay);
    }

    window.scrollTo(0, 0);
    await sleep(settleDelay);
  }, {
    stepDelay: stepDelayMs,
    settleDelay: settleDelayMs
  });
};
