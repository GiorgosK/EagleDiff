async function settleLayout(page, pauseMs = 0) {
  await page.evaluate(async pause => {
    const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frames();
    if (pause) {
      await new Promise(resolve => setTimeout(resolve, pause));
      await frames();
    }
    document.documentElement.getBoundingClientRect();
  }, pauseMs);
}

// After a beyond-viewport capture Chrome restores the viewport and repaints.
// Capturing again within a frame or two can miss layers that are still being
// repainted, such as text with mix-blend-mode below the first screen.
const afterPrimeMs = 100;

module.exports = async function captureScreenshot(page, options, beforeCapture) {
  // Final DOM edits can invalidate layout after the readiness hooks ran.
  await settleLayout(page);
  if (options.fullPage || options.captureBeyondViewport) {
    // Chrome can omit offscreen paint tiles on the first capture after restyling.
    // Prime the same area using the chosen capture mode, without writing it.
    // Only the painting matters, so encode a throwaway low-quality JPEG.
    const { path, ...previewOptions } = options;
    await page.screenshot({ ...previewOptions, type: 'jpeg', quality: 1 });
    await settleLayout(page, afterPrimeMs);
  }
  if (beforeCapture) await beforeCapture();
  // Fast PNG encoding is lossless and about 3x faster on tall pages, at the
  // cost of larger files. It is deterministic, so unchanged pixels still give
  // identical bytes and the comparison can skip them.
  return page.screenshot({ optimizeForSpeed: true, ...options });
};
