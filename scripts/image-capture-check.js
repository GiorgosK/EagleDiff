// Share capture exclusions without adding globals or DOM attributes.
// Return a reason so lazy-source promotion skips only display:none subtrees.
module.exports = async function withImageCaptureCheck(page, run) {
  const check = await page.evaluateHandle(() => image => {
    for (let element = image; element; element = element.parentElement) {
      if (getComputedStyle(element).display === 'none') return 'display-none';
    }
    if (image.src !== 'data:,' || (image.currentSrc && image.currentSrc !== 'data:,')) return false;
    if (image.srcset.trim() || Array.from(image.closest('picture')?.querySelectorAll('source') || [])
      .some(source => source.getAttribute('srcset')?.trim())) return false;
    const visibility = getComputedStyle(image).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return 'empty-placeholder';
    if (!image.getClientRects().length) return 'empty-placeholder';
    for (let element = image; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.opacity === '0') return 'empty-placeholder';
    }
    return false;
  });
  try {
    return await run(check);
  } finally {
    await check.dispose();
  }
};
