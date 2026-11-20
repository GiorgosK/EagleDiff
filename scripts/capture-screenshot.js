async function settleLayout(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.getBoundingClientRect();
  });
}

module.exports = async function captureScreenshot(page, options, beforeCapture) {
  // Final DOM edits can invalidate layout after the readiness hooks ran.
  await settleLayout(page);
  if (options.fullPage || options.captureBeyondViewport) {
    // Chrome can omit offscreen paint tiles on the first capture after restyling.
    // Prime the same area using the chosen capture mode, without writing it.
    // Only the painting matters, so encode a throwaway low-quality JPEG.
    const { path, ...previewOptions } = options;
    await page.screenshot({ ...previewOptions, type: 'jpeg', quality: 1 });
    await settleLayout(page);
  }
  if (beforeCapture) await beforeCapture();
  // Fast PNG encoding is lossless and about 3x faster on tall pages, at the
  // cost of larger files. It is deterministic, so unchanged pixels still give
  // identical bytes and the comparison can skip them.
  return page.screenshot({ optimizeForSpeed: true, ...options });
};
