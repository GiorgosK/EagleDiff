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
      const faces = [...document.fonts];
      const failed = faces.filter(face => face.status === 'error');
      if (!failed.length) return null;
      // A local-only alias can be unavailable on this OS without any failed
      // download. Prove its source from readable CSS; unknown sources stay strict.
      const key = (family, style, weight, stretch, range) => JSON.stringify([
        family.replace(/^(["'])(.*)\1$/, '$2').toLowerCase(), style, weight, stretch, range
      ]);
      const faceKey = face => key(face.family, face.style, face.weight, face.stretch, face.unicodeRange);
      const declarations = new Map();
      const localCall = String.raw`local\((?:[^"'()\\]|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*\)`;
      const localOnly = new RegExp(`^\\s*${localCall}(?:\\s*,\\s*${localCall})*\\s*$`, 'i');
      const scanRules = rules => {
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const value = (name, fallback = 'normal') => rule.style.getPropertyValue(name) || fallback;
            const id = key(value('font-family', ''), value('font-style'), value('font-weight'),
              value('font-stretch'), value('unicode-range', 'U+0-10FFFF'));
            const entry = declarations.get(id) || { count: 0, localOnly: true };
            entry.count += 1;
            entry.localOnly &&= localOnly.test(value('src', ''));
            declarations.set(id, entry);
          } else if (rule.type === CSSRule.IMPORT_RULE) {
            if (rule.styleSheet && !rule.supportsText) scanSheet(rule.styleSheet);
          } else if (rule.cssRules) {
            if (rule.type === CSSRule.MEDIA_RULE && !matchMedia(rule.conditionText).matches) continue;
            if (rule.type === CSSRule.SUPPORTS_RULE && !CSS.supports(rule.conditionText)) continue;
            scanRules(rule.cssRules);
          }
        }
      };
      const scanSheet = sheet => {
        if (sheet.disabled || (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches)) return;
        let rules;
        try { rules = sheet.cssRules; }
        catch (error) { if (error.name === 'SecurityError') return; throw error; }
        if (rules) scanRules(rules);
      };
      for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) scanSheet(sheet);
      const counts = new Map();
      for (const face of faces) counts.set(faceKey(face), (counts.get(faceKey(face)) || 0) + 1);
      const blocking = failed.filter(face => {
        const id = faceKey(face);
        const declaration = declarations.get(id);
        // Counts must also agree: an additional JS-created or opaque CSS face
        // with the same descriptors must not inherit an alias's exemption.
        return !declaration?.localOnly || declaration.count !== counts.get(id);
      });
      if (blocking.length) return { code: 'EAGLEDIFF_FONT_LOAD', message: 'Web fonts failed to load: ' +
        [...new Set(blocking.map(face => `${face.family} (weight ${face.weight}, style ${face.style})`))].join(', ') };
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
