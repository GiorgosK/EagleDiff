function resolveRetryMode(config) {
  const mode = config.core?.temporaryErrorRetryMode ?? 'immediate';
  if (!['immediate', 'deferred'].includes(mode)) {
    throw new Error('core.temporaryErrorRetryMode must be "immediate" or "deferred".');
  }
  return mode;
}

async function runDeferredCaptures(captures, capture, isCancelled) {
  const failures = [];
  for (const [index, entry] of captures.entries()) {
    if (isCancelled?.()) throw new Error('Capture run cancelled.');
    try {
      await capture(entry, index);
    } catch (error) {
      if (isCancelled?.()) throw error;
      for (let cause = error; cause; cause = cause.cause) {
        if (cause.code === 'EAGLEDIFF_CHALLENGE_DETECTED') throw error;
      }
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) {
    throw new AggregateError(failures,
      `Capture failed: ${failures.length} deferred captures did not recover.\n` +
      failures.map(error => error.message).join('\n\n'), { cause: failures[0] });
  }
}

module.exports = { resolveRetryMode, runDeferredCaptures };
