// Count-up widgets animate numbers (0 → 1,200) for a second or two after they
// scroll into view, so a capture can catch an in-between value. Wait until the
// visible counters' text has stopped changing. Tested with Elementor; the other
// selectors follow those libraries' markup.
const automaticSelectors = [
  '.elementor-counter-number', // Elementor
  '.odometer', // Odometer
  '.kb-count-up-number', // Kadence Blocks
  '.et_pb_number_counter .percent-value', // Divi
  '.fusion-counter-box .display-counter' // Avada
];
const settleMs = 500;

module.exports = async function waitForCounters(page, context) {
  // null selects automatic detection; an explicit [] disables the wait.
  const configured = context.scenario.counterSelectors !== undefined
    ? context.scenario.counterSelectors : context.config.defaults?.counterSelectors;
  const selectors = configured ?? automaticSelectors;
  const list = (Array.isArray(selectors) ? selectors : [selectors]).map(String).map(selector => selector.trim()).filter(Boolean);
  if (!list.length) return;
  const timeout = context.scenario.counterTimeout ?? context.config.defaults?.counterTimeout ?? 10000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('counterTimeout must be a positive number of milliseconds.');

  const result = await page.evaluate(async (currentSelectors, timeoutMs, quietMs) => {
    const counters = () => currentSelectors.flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const read = () => counters().map(element => element.textContent.trim()).join('|');
    const count = counters().length;
    if (!count) return { count, settled: true };
    const started = performance.now();
    let last = read();
    let changedAt = started;
    while (performance.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const current = read();
      if (current !== last) {
        last = current;
        changedAt = performance.now();
      } else if (performance.now() - changedAt >= quietMs) {
        return { count, settled: true };
      }
    }
    return { count, settled: false, sample: last.slice(0, 80) };
  }, list, timeout, settleMs);

  if (!result.settled) {
    const message = `Counters were still changing after ${timeout}ms (${result.sample}); the capture may differ between runs. ` +
      'Set counterSelectors to [] for this scenario if the numbers change on purpose.';
    if (context.reportWarning) context.reportWarning('counters-not-settled', message);
    else console.warn(`[eaglediff] ${message}`);
  }
};

module.exports.automaticSelectors = automaticSelectors;
