function detectChallengeHeaders(headers = {}) {
  const values = Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) =>
    [key.toLowerCase(), String(value).trim().toLowerCase()]));
  // Provider-specific challenge headers, not generic CDN or HTTP error headers.
  if (values['cf-mitigated'] === 'challenge') return 'Cloudflare';
  if (['challenge', 'captcha'].includes(values['x-amzn-waf-action'])) return 'AWS WAF';
  return null;
}

function challengeError(provider, url, cause) {
  let location = 'the requested page';
  try {
    const parsed = new URL(url);
    location = `${parsed.origin}${parsed.pathname}`;
  } catch { /* A page can be closing or have no HTTP URL yet. */ }
  const error = new Error(`[eaglediff] Warning: ${provider} security challenge detected at ${location}. Capture stopped because the website page is unavailable.\nUse a staging/development environment or ask the site's administrator to configure an exception for your test traffic.`, cause ? { cause } : undefined);
  error.code = 'EAGLEDIFF_CHALLENGE_DETECTED';
  return error;
}

async function assertNoChallenge(page, response = {}) {
  const provider = detectChallengeHeaders(response.navigationResponseHeaders);
  if (provider) throw challengeError(provider, response.navigationResponseUrl || page.url());

  const detected = await page.evaluate(() => {
    function source(element) {
      const src = element.getAttribute('src');
      if (!src) return null;
      try { return new URL(src, document.baseURI); }
      catch { return null; }
    }
    function visible(element) {
      if (!element) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth;
    }
    const scripts = Array.from(document.scripts).map(source).filter(Boolean);
    const cloudflare = scripts.some(url => url.pathname.includes('/cdn-cgi/challenge-platform/')
      && url.pathname.includes('/orchestrate/chl_page/'));
    const cloudflareLegacy = document.querySelector('#challenge-form, #challenge-stage')
      && (window._cf_chl_opt || scripts.some(url => url.pathname.includes('/cdn-cgi/challenge-platform/')));
    if (cloudflare || cloudflareLegacy) return 'Cloudflare';

    // DataDome uses these frames for blocked requests, unlike its normal JS tag.
    for (const frame of document.querySelectorAll('iframe[src]')) {
      const url = source(frame);
      if (url && (url.hostname === 'captcha-delivery.com' || url.hostname.endsWith('.captcha-delivery.com'))
        && visible(frame)) return 'DataDome';
    }
    // Require both the block-page widget and its provider's CAPTCHA script.
    if (visible(document.querySelector('#px-captcha')) && scripts.some(url =>
      url.hostname === 'captcha.px-cdn.net' && url.pathname.endsWith('/captcha.js'))) return 'HUMAN/PerimeterX';
    return null;
  });
  if (detected) throw challengeError(detected, page.url());
}

module.exports = { detectChallengeHeaders, challengeError, assertNoChallenge };
