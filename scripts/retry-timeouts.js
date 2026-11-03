// Increase readiness budgets on retries without changing concurrency or delays.
const timeoutKeys = [
  'navigationTimeout', 'readyTimeout', 'fontTimeout', 'lazyImageTimeout', 'iframeTimeout',
  'scrollTimeout', 'waitUntilGoneTimeout', 'networkIdleTimeout'
];

function retryTimeoutFactor(config, attempt) {
  const multiplier = config.core?.temporaryErrorRetryTimeoutMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new Error('core.temporaryErrorRetryTimeoutMultiplier must be a finite number of at least 1.');
  }
  const factor = multiplier ** attempt;
  if (!Number.isFinite(factor)) throw new Error('Retry timeout multiplier exceeds the supported range.');
  return factor;
}

function scaleTimeouts(settings, factor) {
  if (!settings || factor === 1) return settings;
  const scaled = { ...settings };
  const scale = value => {
    if (!Number.isFinite(value) || value <= 0) return value;
    const result = Math.ceil(value * factor);
    if (result > 2147483647) throw new Error('Retry timeout exceeds the supported timer range.');
    return result;
  };
  for (const key of timeoutKeys) {
    if (Object.hasOwn(settings, key)) scaled[key] = scale(settings[key]);
  }
  for (const key of ['browserVerification', 'waitForStableContent']) {
    if (settings[key] && Object.hasOwn(settings[key], 'timeout')) {
      scaled[key] = { ...settings[key], timeout: scale(settings[key].timeout) };
    }
  }
  return scaled;
}

function withRetryTimeouts(config, scenario, attempt) {
  const factor = retryTimeoutFactor(config, attempt);
  return {
    config: factor === 1 ? config : { ...config, defaults: scaleTimeouts(config.defaults, factor) },
    scenario: scaleTimeouts(scenario, factor)
  };
}

module.exports = { withRetryTimeouts, retryTimeoutFactor };
