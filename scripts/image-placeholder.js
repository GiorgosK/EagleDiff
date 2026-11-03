// Share this browser-side predicate without adding globals or DOM attributes.
module.exports = async function withImagePlaceholderCheck(page, run) {
  const check = await page.evaluateHandle(() => image => {
    if (image.src !== 'data:,' || (image.currentSrc && image.currentSrc !== 'data:,')) return false;
    if (image.srcset.trim() || Array.from(image.closest('picture')?.querySelectorAll('source') || [])
      .some(source => source.getAttribute('srcset')?.trim())) return false;
    const visibility = getComputedStyle(image).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return true;
    if (!image.getClientRects().length) return true;
    for (let element = image; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.opacity === '0') return true;
    }
    return false;
  });
  try {
    return await run(check);
  } finally {
    await check.dispose();
  }
};
