module.exports = async function waitForFonts(page, context = {}) {
  const timeout = context.scenario?.fontTimeout ?? context.config?.defaults?.fontTimeout ?? 30000;
  const required = context.scenario?.requiredFonts ?? context.config?.defaults?.requiredFonts ?? [];
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('fontTimeout must be a positive number.');
  if (!Array.isArray(required) || required.some(font => typeof font !== 'string' || !font.trim())) {
    throw new Error('requiredFonts must be an array of CSS font specifications, such as "400 16px Inter".');
  }

  const failure = await page.evaluate(async ({ timeoutMs, requiredFonts }) => {
    if (!document.fonts) return { message: 'The browser does not support font readiness checks.' };
    let timer;
    const check = async () => {
      // Trigger layout before waiting: newly inserted text may need fonts that
      // were not requested when the earlier readiness hooks ran.
      document.documentElement.getBoundingClientRect();
      for (const font of requiredFonts) {
        let faces;
        try {
          faces = await document.fonts.load(font);
        } catch (error) {
          return { code: error.name === 'SyntaxError' ? undefined : 'EAGLEDIFF_FONT_LOAD',
            message: `Cannot load required font: ${font}\n${error.message}` };
        }
        // check() alone reports success for an undeclared family, which would
        // silently allow a fallback font when the font stylesheet is missing.
        if (!faces.length) return { code: 'EAGLEDIFF_FONT_LOAD', message: `Required web font is not declared: ${font}. Check its font stylesheet.` };
      }
      await document.fonts.ready;
      const failed = [...document.fonts].filter(face => face.status === 'error');
      if (failed.length) return { code: 'EAGLEDIFF_FONT_LOAD', message: 'Web fonts failed to load: ' +
        [...new Set(failed.map(face => `${face.family} (weight ${face.weight}, style ${face.style})`))].join(', ') };
      return null;
    };
    try {
      return await Promise.race([
        check(),
        new Promise(resolve => {
          timer = setTimeout(() => resolve({ code: 'EAGLEDIFF_FONT_TIMEOUT',
            message: `Fonts did not become ready within ${timeoutMs}ms. Adjust fontTimeout for slow font loading.` }), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, { timeoutMs: timeout, requiredFonts: required });
  if (failure) {
    const error = new Error(failure.message);
    error.code = failure.code;
    throw error;
  }
};
