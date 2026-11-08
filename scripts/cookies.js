const fs = require('fs/promises');
const path = require('path');

async function applyCookies(context, url, scenario, defaults, configPath, reportWarning) {
  const setting = key => Object.hasOwn(scenario, key) ? scenario[key] : defaults?.[key];
  const cookiePath = setting('cookiePath');
  let cookies = [];
  if (cookiePath) {
    const file = path.resolve(path.dirname(configPath), cookiePath);
    try {
      cookies = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot load cookiePath ${file}: ${error.message}`, { cause: error });
    }
    if (!Array.isArray(cookies)) throw new Error('cookiePath must contain a JSON array of cookies.');
  }
  const inline = setting('cookies') ?? [];
  if (!Array.isArray(inline)) throw new Error('cookies must be an array.');
  cookies = [...cookies, ...inline];
  const hostname = new URL(url).hostname;
  const domainOverride = setting('cookieDomain');
  const expiry = setting('cookieExpiry');
  if (expiry && expiry !== 'session') throw new Error('cookieExpiry must be "session" or null.');
  const prepared = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== 'string' || !cookie.name || typeof cookie.value !== 'string') {
      throw new Error('Each cookie must have a non-empty name and a string value.');
    }
    const result = Object.fromEntries(Object.entries(cookie).filter(([key]) => [
      'name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expires',
      'priority', 'sourceScheme', 'partitionKey'
    ].includes(key)));
    result.domain = domainOverride === 'current' ? hostname
      : domainOverride || cookie.domain || (cookie.url ? new URL(cookie.url).hostname : hostname);
    if (/^https?:\/\//i.test(result.domain)) result.domain = new URL(result.domain).hostname;
    result.path ||= '/';
    if (expiry === 'session') delete result.expires;
    if (result.expires >= 0 && result.expires <= Date.now() / 1000) {
      reportWarning('expired-cookies', 'Expired cookies were skipped. Refresh the cookie file, or set cookieExpiry="session" for reusable test fixtures.');
      continue;
    }
    const domain = result.domain.replace(/^\./, '').toLowerCase();
    if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
      reportWarning('cookie-domain', 'Warning: Some cookies target a different domain from the capture URL. Set cookieDomain="current" to explicitly apply test cookies to each environment.');
    }
    prepared.push(result);
  }
  if (prepared.length) await context.setCookie(...prepared);
}

module.exports = { applyCookies };
