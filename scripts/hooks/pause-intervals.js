// Repeating timers with a long period rotate testimonials, slides and news
// tickers, or refresh content, so a capture shows whichever state the timer
// reached. Installed before navigation, this keeps setInterval timers of
// pauseIntervals milliseconds or longer from running; shorter intervals and
// one-off setTimeout calls (late content, popups) run normally.
function resolveOptions(config = {}, scenario = {}) {
  const value = scenario.pauseIntervals !== undefined ? scenario.pauseIntervals : config.defaults?.pauseIntervals;
  if (value === undefined || value === null) return { minimumDelay: 2000 };
  if (value === false) return { minimumDelay: null };
  if (!Number.isFinite(value) || value <= 0) throw new Error('pauseIntervals must be a positive number of milliseconds, or false.');
  return { minimumDelay: value };
}

function installIntervalPause(minimumDelay) {
  if (window.__eaglediffIntervalPause) return;
  window.__eaglediffIntervalPause = true;
  const setInterval = window.setInterval;
  // A real interval that never fires keeps the returned id valid for clearInterval.
  window.setInterval = function (handler, delay, ...args) {
    if (Number(delay) >= minimumDelay) return setInterval.call(window, () => {}, 2147483647);
    return setInterval.call(window, handler, delay, ...args);
  };
}

module.exports = async function pauseIntervals(page, context = {}) {
  const { minimumDelay } = resolveOptions(context.config, context.scenario);
  if (minimumDelay === null || context.mode !== 'before') return;
  await page.evaluateOnNewDocument(installIntervalPause, minimumDelay);
};
module.exports.resolveOptions = resolveOptions;
