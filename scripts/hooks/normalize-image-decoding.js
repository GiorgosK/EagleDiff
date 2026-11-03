module.exports = async function normalizeImageDecoding(page, context) {
  const selectors = context.scenario.normalizeImageDecodingSelectors
    ?? context.config.defaults?.normalizeImageDecodingSelectors
    ?? ['img'];
  const selector = (Array.isArray(selectors) ? selectors : [selectors]).filter(Boolean).join(',');
  if (!selector) return;

  const networkFailures = new Map();
  const corsErrors = [];
  const onConsole = message => {
    if (message.type() === 'error' && /CORS|Cross-Origin/i.test(message.text())) {
      corsErrors.push(message.text());
    }
  };
  const onRequestFailed = request => {
    const reason = request.failure()?.errorText;
    if (!reason) return;
    for (const entry of [...request.redirectChain(), request]) {
      networkFailures.set(entry.url(), { reason, url: request.url() });
    }
  };
  page.on('requestfailed', onRequestFailed);
  page.on('console', onConsole);
  let warnings;
  try {
    warnings = await page.evaluate(async (currentSelector, failedSources) => {
      const normalized = new Map();
      const skipped = new Set();
      for (const image of document.querySelectorAll(currentSelector)) {
        if (!(image instanceof HTMLImageElement)) continue;
        const source = image.currentSrc || image.src;
        // Warning mode keeps broken originals for comparison; do not try to
        // fetch those same failed images again during optional JPEG normalization.
        if (failedSources.includes(source) || failedSources.includes(image.src)) continue;
        const isGif = /\.gif(?:[?#]|$)/i.test(source) || /^data:image\/gif[;,]/i.test(source);
        if (!isGif && !/\.jpe?g(?:[?#]|$)/i.test(source)) continue;
        if (skipped.has(source)) continue;

        let stage = 'fetching';
        try {
          if (!normalized.has(source)) {
            let response;
            try {
              response = await fetch(source, { cache: 'force-cache' });
            } catch (error) {
              // Displaying an image does not require permission to read its bytes.
              // This also covers same-origin URLs redirected to a non-CORS CDN.
              // Only skip this optional normalization if the original really loads.
              try {
                await image.decode();
                if (!image.naturalWidth || !image.naturalHeight) throw error;
              } catch {
                throw error;
              }
              skipped.add(source);
              continue;
            }
            if (!response.ok) throw new Error(`Cannot normalize image (${response.status}): ${source}`);
            stage = 'reading response';
            const blob = await response.blob();
            if (blob.type !== 'image/jpeg' && blob.type !== 'image/gif') continue;

            // Decode at intrinsic resolution before the browser scales the displayed image.
            // The HTML standard defines an animated bitmap's default/first frame.
            stage = blob.type === 'image/gif' ? 'decoding GIF' : 'decoding JPEG';
            const bitmap = await createImageBitmap(blob);
            try {
              stage = 'encoding PNG';
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
          stage = 'decoding replacement';
          await image.decode();
        } catch (error) {
          throw new Error(`Cannot normalize image during ${stage}: ${source}\n${error.message}`);
        }
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Array.from(skipped);
    }, selector, context.failedImageSources || []);
  } catch (error) {
    const failures = [...networkFailures].filter(([url]) => error.message.includes(url));
    const details = [...new Set(failures.map(([, failure]) => `Network error: ${failure.reason} (${failure.url})`))];
    details.push(...new Set(corsErrors.filter(message => failures.some(([url]) => message.includes(url)))));
    if (details.length) throw new Error(`${error.message}\n${details.join('\n')}`, { cause: error });
    throw error;
  } finally {
    page.off('requestfailed', onRequestFailed);
    page.off('console', onConsole);
  }
  const gifWarnings = warnings.filter(source => /\.gif(?:[?#]|$)|^data:image\/gif[;,]/i.test(source));
  warnings = warnings.filter(source => !gifWarnings.includes(source));
  if (gifWarnings.length) {
    const message = `Some GIF images could not be fetched to freeze their first frame; originals loaded successfully but may keep animating. Allow CORS on the image server or use a same-origin image. Page: ${page.url()}.`;
    if (context.reportWarning) context.reportWarning('gif-normalization-skipped', message);
    else console.warn(`[eaglediff] ${message}`);
  }
  if (warnings.length) {
    const message = `Some JPEG images could not be fetched for normalization; originals loaded successfully and are unchanged, but may produce decoding differences. Page: ${page.url()}. Example: ${warnings[0]}. Cross-origin redirects or missing CORS permission can cause this. Use consistent page/image origins or allow CORS on the image server. Further warnings of this type are suppressed for this run.`;
    if (context.reportWarning) context.reportWarning('image-normalization-skipped', message);
    else console.warn(`[eaglediff] ${message}`);
  }
};
