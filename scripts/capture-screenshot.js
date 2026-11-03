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
    const { path, ...previewOptions } = options;
    await page.screenshot(previewOptions);
    await settleLayout(page);
  }
  if (beforeCapture) await beforeCapture();
  return page.screenshot(options);
};
