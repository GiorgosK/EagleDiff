module.exports = async function normalizeImageDecoding(page, context) {
  const selectors = context.scenario.normalizeImageDecodingSelectors
    ?? context.config.defaults?.normalizeImageDecodingSelectors
    ?? ['img'];
  const selector = (Array.isArray(selectors) ? selectors : [selectors]).filter(Boolean).join(',');
  if (!selector) return;

  const warnings = await page.evaluate(async (currentSelector) => {
    const normalized = new Map();
    const skipped = new Set();
    for (const image of document.querySelectorAll(currentSelector)) {
      if (!(image instanceof HTMLImageElement)) continue;
      const source = image.currentSrc || image.src;
      if (!/\.jpe?g(?:[?#]|$)/i.test(source)) continue;
      if (skipped.has(source)) continue;

      if (!normalized.has(source)) {
        let response;
        try {
          response = await fetch(source, { cache: 'force-cache' });
        } catch (error) {
          // A CDN image can display without granting permission to read its bytes.
          if (new URL(source).origin === location.origin) throw error;
          skipped.add(source);
          continue;
        }
        if (!response.ok) throw new Error(`Cannot normalize image (${response.status}): ${source}`);
        const blob = await response.blob();
        if (blob.type !== 'image/jpeg') continue;

        // Decode at intrinsic resolution before the browser scales the displayed image.
        const bitmap = await createImageBitmap(blob);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (!png) throw new Error(`Cannot encode normalized image: ${source}`);
          normalized.set(source, URL.createObjectURL(png));
        } finally {
          bitmap.close();
        }
      }

      image.closest('picture')?.querySelectorAll('source').forEach(source => source.removeAttribute('srcset'));
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.loading = 'eager';
      image.src = normalized.get(source);
      await image.decode();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Array.from(skipped);
  }, selector);
  if (warnings.length) {
    const message = `Some cross-origin JPEG images could not be normalized; originals are unchanged and may produce decoding differences. Example: ${warnings[0]}. Use consistent page/image origins or allow CORS on the image server. Setting defaults.normalizeImageDecodingSelectors to [] disables normalization, but loses its stabilization benefit. Further warnings of this type are suppressed for this run.`;
    if (context.reportWarning) context.reportWarning('image-normalization-skipped', message);
    else console.warn(`[reg-suit] ${message}`);
  }
};
