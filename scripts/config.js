const reportError = require('./cli-error');
const fsp = require('fs/promises');
const path = require('path');

const puppeteer = require('puppeteer-core');
const { assertNoChallenge, detectChallengeHeaders, challengeError } = require('./challenge-detector');
const {
  getScenarioLabel,
  getScenarioUrl,
  resolveChromePath
} = require('./run');
const { getConfigPath, helperDir, rootDir } = require('./config-path');
const { isNavigationContextError } = require('./navigation');

const defaultConfigPath = path.join(helperDir, 'config-default.json');
const defaultExcludeExtensions = require('../config-default.json').excludeExtensions;
const defaultDiscoveryLimit = 25;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = getConfigPath();
  const templateConfig = await loadTemplateConfig();
  const existingConfig = await readJsonIfExists(configPath);
  const baseConfig = mergeDeep(templateConfig, existingConfig || {});
  const hasExistingConfig = Boolean(existingConfig);
  const explicitReferenceBaseURL = args.referenceBaseURL || args.referenceBaseUrl || args.ref || args.urlRef;
  const explicitTestBaseURL = args.testBaseURL || args.testBaseUrl || args.test || args.urlTest;
  const outputReferenceBaseURL = hasExistingConfig
    ? baseConfig.referenceBaseURL
    : explicitReferenceBaseURL;
  const outputTestBaseURL = hasExistingConfig
    ? baseConfig.testBaseURL
    : explicitTestBaseURL || outputReferenceBaseURL;

  if (!hasExistingConfig && (!outputReferenceBaseURL || !outputTestBaseURL)) {
    throw new Error('Usage: node scripts/config.js --ref=<reference-url> [--test=<test-url>] [--limit=<count>]');
  }

  const discoverySources = resolveDiscoverySources(
    args.links.length > 0
      ? args.links
      : [outputReferenceBaseURL, outputTestBaseURL]
  );

  const limit = Math.max(1, Number(args.limit || defaultDiscoveryLimit) || defaultDiscoveryLimit);
  const discoveredScenarios = await discoverScenarios({
    discoverySources,
    limit,
    excludeExtensions: baseConfig.excludeExtensions
  });

  const existingScenarios = Array.isArray(baseConfig.scenarios) ? baseConfig.scenarios : [];
  const mergedScenarios = mergeScenarios(existingScenarios, discoveredScenarios, baseConfig.excludeExtensions);

  const outputConfig = {
    ...baseConfig,
    referenceBaseURL: outputReferenceBaseURL,
    testBaseURL: outputTestBaseURL,
    scenarios: mergedScenarios
  };

  await fsp.writeFile(configPath, `${JSON.stringify(outputConfig, null, 2)}\n`);
  await ensureGitignore(rootDir);
  console.log(`[eaglediff] Wrote ${path.relative(rootDir, configPath)} with ${discoveredScenarios.length} discovered scenarios`);
}

async function ensureGitignore(projectDir) {
  const gitignorePath = path.join(projectDir, '.gitignore');
  let existing = '';
  try {
    existing = await fsp.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (existing.split(/\r?\n/).some((line) => ['.reg', '.reg/', '/.reg', '/.reg/'].includes(line.trim()))) return;

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fsp.writeFile(gitignorePath, `${existing}${separator}.reg/\n`);
}

async function discoverScenarios({ discoverySources, limit, excludeExtensions }) {
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors'
    ],
    ignoreHTTPSErrors: true,
    executablePath: resolveChromePath(),
    headless: true
  });

  let browserContext;
  try {
    browserContext = await browser.createBrowserContext();
    const discovered = [{ url: '/', label: 'Homepage' }];
    const seenUrls = new Set(['/']);

    for (const baseUrl of discoverySources) {
      const page = await browserContext.newPage();
      const navigation = {};
      let signalChallenge;
      const challengeDetected = new Promise(resolve => { signalChallenge = resolve; });
      const trackResponse = response => {
        const request = response.request();
        if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
        if (response.status() >= 300 && response.status() < 400) return;
        navigation.navigationResponseHeaders = response.headers();
        navigation.navigationResponseUrl = response.url();
        const provider = detectChallengeHeaders(response.headers());
        if (provider) signalChallenge({ provider, url: response.url() });
      };
      page.on('response', trackResponse);
      let completed = false;
      try {
        await Promise.race([
          page.goto(baseUrl, { waitUntil: 'domcontentloaded' }),
          challengeDetected.then(({ provider, url }) => { throw challengeError(provider, url, undefined, 'Page discovery'); })
        ]);
        const { links, pageUrl } = await Promise.race([
          readDiscoveryLinks(page, navigation),
          challengeDetected.then(({ provider, url }) => { throw challengeError(provider, url, undefined, 'Page discovery'); })
        ]);

        for (const link of links) {
          if (discovered.length >= limit) {
            break;
          }

          const normalized = normalizeLink(pageUrl, link, excludeExtensions);
          if (!normalized || seenUrls.has(normalized.url)) {
            continue;
          }

          seenUrls.add(normalized.url);
          discovered.push(normalized);
        }
        completed = true;
      } finally {
        page.off('response', trackResponse);
        if (completed) await page.close();
      }
    }

    return discovered;
  } finally {
    // Closing an interrupted page can wait for a navigation commit. Dispose
    // the shared context first to cancel navigation, then close the browser.
    try { await browserContext?.close(); }
    finally { await browser.close(); }
  }
}

async function readDiscoveryLinks(page, navigation) {
  const deadline = Date.now() + 30000;
  let lastError;
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    try {
      if (attempt) await sleep(250);
      await assertNoChallenge(page, navigation, 'Page discovery');
      await sleep(1000);
      const ready = await page.waitForFunction(() => document.readyState !== 'loading', {
        timeout: Math.max(1, deadline - Date.now())
      });
      await ready.dispose();
      await assertNoChallenge(page, navigation, 'Page discovery');
      const snapshot = await page.$$eval('a[href]', anchors => ({
        pageUrl: location.href,
        links: anchors.map(anchor => ({
          href: anchor.getAttribute('href') || '',
          text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
          title: (anchor.getAttribute('title') || '').trim(),
          ariaLabel: (anchor.getAttribute('aria-label') || '').trim()
        }))
      }));
      await assertNoChallenge(page, navigation, 'Page discovery');
      if (page.url() === snapshot.pageUrl) return snapshot;
      lastError = new Error('The page navigated after its links were read.');
    } catch (error) {
      if (!isNavigationContextError(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(`Page discovery was interrupted by repeated navigation at ${page.url()}. Try --links with the final destination URL.`, { cause: lastError });
}

function normalizeLink(pageUrl, link, excludeExtensions = defaultExcludeExtensions) {
  if (!link || !link.href) {
    return null;
  }

  // Check before URL parsing: a placeholder's '#' becomes a fragment and
  // otherwise leaves a seemingly valid path such as '/[' behind.
  if ([link.href, link.text, link.title, link.ariaLabel].some(hasTemplateToken)) {
    return null;
  }

  let urlObject;
  try {
    urlObject = new URL(link.href, pageUrl);
  } catch (error) {
    return null;
  }

  if (!/^https?:$/i.test(urlObject.protocol)) {
    return null;
  }

  const pageOrigin = new URL(pageUrl).origin;
  if (urlObject.origin !== pageOrigin) {
    return null;
  }

  if (!urlObject.pathname || urlObject.pathname === '/#') {
    return null;
  }

  if (hasExcludedExtension(urlObject.href, excludeExtensions)) {
    return null;
  }

  if (hasUnmatchedBrackets(decodeForValidation(urlObject.pathname))) {
    return null;
  }

  const url = normalizePath(urlObject.pathname, urlObject.search);
  if (!url || url === '/' || url.startsWith('/#')) {
    return null;
  }

  const label = getLabel(link, urlObject.pathname);

  return {
    url,
    label
  };
}

function decodeForValidation(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function hasTemplateToken(value) {
  return /\[#[\s\S]*?#\]|\{\{[\s\S]*?\}\}|\$\{[^}]*\}|<%[\s\S]*?%>/.test(decodeForValidation(value));
}

function hasUnmatchedBrackets(value) {
  let depth = 0;
  for (const char of value) {
    if (char === '[') depth += 1;
    if (char === ']' && --depth < 0) return true;
  }
  return depth !== 0;
}

function normalizePath(pathname, search) {
  const trimmedPathname = String(pathname || '')
    .replace(/\/+$/, '')
    .trim();

  if (!trimmedPathname || trimmedPathname === '') {
    return '/';
  }

  return `${trimmedPathname}${search || ''}`;
}

function getLabel(link, pathname) {
  const labelSource = [link.text, link.title, link.ariaLabel]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .find(Boolean);

  if (labelSource) {
    return labelSource;
  }

  return String(pathname || '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, ' ')
    .trim() || getScenarioLabel({ url: pathname });
}

function hasExcludedExtension(url, excludeExtensions) {
  if (!Array.isArray(excludeExtensions)) {
    throw new Error('excludeExtensions must be an array of file extensions.');
  }
  const pathname = decodeForValidation(new URL(url, 'https://example.invalid').pathname).toLowerCase();
  return excludeExtensions.some(extension => {
    if (typeof extension !== 'string' || !extension.trim()) {
      throw new Error('excludeExtensions must contain non-empty strings.');
    }
    const normalized = extension.trim().toLowerCase().replace(/^\./, '');
    return pathname.endsWith(`.${normalized}`);
  });
}

function mergeScenarios(existingScenarios, discoveredScenarios, excludeExtensions = defaultExcludeExtensions) {
  const knownUrls = new Set();
  const knownIdentities = new Set();
  const merged = [];

  for (const scenario of existingScenarios) {
    const url = getScenarioUrl(scenario) || scenario.referenceUrl || '';
    const identity = JSON.stringify([url, String(scenario.label || ''), scenario.id ?? null]);
    if (!url || knownIdentities.has(identity) || hasExcludedExtension(url, excludeExtensions)) {
      continue;
    }

    knownUrls.add(url);
    knownIdentities.add(identity);
    merged.push(scenario);
  }

  for (const scenario of discoveredScenarios) {
    if (knownUrls.has(scenario.url) || hasExcludedExtension(scenario.url, excludeExtensions)) {
      continue;
    }

    knownUrls.add(scenario.url);
    merged.push({
      url: scenario.url,
      label: scenario.label
    });
  }

  const frontpageIndex = merged.findIndex(scenario => getScenarioUrl(scenario) === '/');
  if (frontpageIndex > 0) {
    merged.unshift(...merged.splice(frontpageIndex, 1));
  }

  return merged;
}

function resolveDiscoverySources(rawSources) {
  const sources = [];

  for (const rawSource of rawSources) {
    const source = String(rawSource || '').trim();
    if (!source) {
      continue;
    }

    if (/^https?:\/\//i.test(source)) {
      sources.push(source.replace(/\/+$/, ''));
      continue;
    }

    if (/^[^/\s]+\.[^/\s]+(?:\/.*)?$/i.test(source)) {
      sources.push(`https://${source.replace(/\/+$/, '')}`);
      continue;
    }

    if (sources.length > 0) {
      const baseUrl = sources[sources.length - 1];
      sources[sources.length - 1] = new URL(source, baseUrl).toString().replace(/\/+$/, '');
      continue;
    }

    throw new Error(`Invalid --links value: ${source}`);
  }

  return [...new Set(sources)];
}

function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return overrideValue;
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const result = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      result[key] = key in baseValue ? mergeDeep(baseValue[key], value) : value;
    }
    return result;
  }

  return overrideValue === undefined ? baseValue : overrideValue;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadTemplateConfig() {
  return readJson(defaultConfigPath);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const parsed = {
    limit: process.env.npm_config_limit || null,
    referenceBaseURL: process.env.npm_config_ref || process.env.npm_config_reference || null,
    testBaseURL: process.env.npm_config_test || process.env.npm_config_testurl || null,
    links: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value || value === '--') {
      continue;
    }

    if (value.startsWith('--limit=')) {
      parsed.limit = value.slice('--limit='.length).trim();
    } else if (value === '--limit') {
      parsed.limit = (argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--ref=')) {
      parsed.referenceBaseURL = value.slice('--ref='.length).trim();
    } else if (value === '--ref') {
      parsed.referenceBaseURL = (argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--test=')) {
      parsed.testBaseURL = value.slice('--test='.length).trim();
    } else if (value === '--test') {
      parsed.testBaseURL = (argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--links=')) {
      parsed.links.push(value.slice('--links='.length).trim());
    } else if (value === '--links') {
      parsed.links.push((argv[index + 1] || '').trim());
      index += 1;
    } else if (!value.startsWith('--')) {
      parsed.links.push(value.trim());
    }
  }

  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (require.main === module) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 1;
  });
}

module.exports = { normalizeLink, mergeScenarios };
