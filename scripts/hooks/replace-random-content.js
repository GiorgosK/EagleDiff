module.exports = async function replaceRandomContent(page, context) {
  const entries = key => {
    const value = context.scenario[key] ?? context.config.defaults?.[key] ?? [];
    return (Array.isArray(value) ? value : [value]).map(entry => {
      const options = typeof entry === 'string' ? { selector: entry } : entry;
      if (!options || typeof options.selector !== 'string' || !options.selector.trim()) {
        throw new Error(`${key} entries require a CSS selector.`);
      }
      if (key === 'randomImage' && (options.width !== undefined || options.height !== undefined)) {
        if (![options.width, options.height].every(size => Number.isFinite(size) && size > 0)) {
          throw new Error('randomImage width and height must both be positive numbers.');
        }
      }
      return options;
    });
  };
  const images = entries('randomImage');
  const content = entries('randomContent');
  const replacements = context.scenario.replaceContent ?? context.config.defaults?.replaceContent ?? {};
  if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) {
    throw new Error('replaceContent must be an object mapping CSS selectors to text strings.');
  }
  for (const [selector, text] of Object.entries(replacements)) {
    if (!selector.trim() || typeof text !== 'string') {
      throw new Error('replaceContent requires non-empty CSS selectors and text strings.');
    }
    content.push({ selector, text });
  }
  if (!images.length && !content.length) return;

  await page.evaluate(async ({ images, content }) => {
    const placeholder = (width, height) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 800 450"><rect width="800" height="450" fill="#e2e5e8"/><path d="M0 0L800 450M800 0L0 450" stroke="#b0b8c0" stroke-width="3"/><rect x="180" y="193" width="440" height="64" rx="8" fill="#e2e5e8"/><text x="400" y="234" text-anchor="middle" font-family="monospace" font-size="28" fill="#46515c">IMAGE PLACEHOLDER</text></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    };

    for (const entry of content) {
      for (const element of document.querySelectorAll(entry.selector)) {
        element.textContent = entry.text ?? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
      }
    }

    for (const entry of images) {
      for (const element of document.querySelectorAll(entry.selector)) {
        const targets = element instanceof HTMLImageElement ? [element] : Array.from(element.querySelectorAll('img'));
        if (!targets.length) {
          const rect = element.getBoundingClientRect();
          const source = placeholder(entry.width || Math.max(1, rect.width), entry.height || Math.max(1, rect.height));
          element.style.setProperty('background-image', `url("${source}")`, 'important');
          continue;
        }
        for (const image of targets) {
          const rect = image.getBoundingClientRect();
          const width = entry.width || image.naturalWidth || Math.max(1, rect.width);
          const height = entry.height || image.naturalHeight || Math.max(1, rect.height);
          image.closest('picture')?.querySelectorAll('source').forEach(source => source.removeAttribute('srcset'));
          for (const attribute of ['srcset', 'sizes', 'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy-srcset']) {
            image.removeAttribute(attribute);
          }
          image.loading = 'eager';
          image.alt = 'Image placeholder';
          image.src = placeholder(width, height);
          await image.decode();
        }
      }
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { images, content });
};
