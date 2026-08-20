const fsp = require('fs/promises');
const path = require('path');

const puppeteer = require('puppeteer-core');
const {
  getScenarioLabel,
  getScenarioUrl,
  resolveChromePath
} = require('./run');
const { getConfigPath, helperDir, rootDir } = require('./config-path');

const defaultConfigPath = path.join(helperDir, 'config-default.json');

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
    : explicitTestBaseURL;

  if (!hasExistingConfig && (!outputReferenceBaseURL || !outputTestBaseURL)) {
    throw new Error('Usage: node scripts/config.js --ref=<reference-url> --test=<test-url> [--limit=15]');
  }

  const discoverySources = resolveDiscoverySources(
    args.links.length > 0
      ? args.links
      : [outputReferenceBaseURL, outputTestBaseURL]
  );

  const limit = Math.max(1, Number(args.limit || 15) || 15);
  const discoveredScenarios = await discoverScenarios({
    discoverySources,
    limit
  });

  const existingScenarios = Array.isArray(baseConfig.scenarios) ? baseConfig.scenarios : [];
  const mergedScenarios = mergeScenarios(existingScenarios, discoveredScenarios);

  const outputConfig = {
    ...baseConfig,
    referenceBaseURL: outputReferenceBaseURL,
    testBaseURL: outputTestBaseURL,
    scenarios: mergedScenarios
  };

  await fsp.writeFile(configPath, `${JSON.stringify(outputConfig, null, 2)}\n`);
  console.log(`[reg-suit] Wrote ${path.relative(rootDir, configPath)} with ${discoveredScenarios.length} discovered scenarios`);
}

async function discoverScenarios({ discoverySources, limit }) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ignoreHTTPSErrors: true,
    executablePath: resolveChromePath(),
    headless: true
  });

  try {
    const discovered = [];
    const seenUrls = new Set();

    for (const baseUrl of discoverySources) {
      const page = await browser.newPage();
      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await sleep(1000);

        const links = await page.$$eval('a[href]', (anchors) => anchors.map((anchor) => ({
          href: anchor.getAttribute('href') || '',
          text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
          title: (anchor.getAttribute('title') || '').trim(),
          ariaLabel: (anchor.getAttribute('aria-label') || '').trim()
        })));

        for (const link of links) {
          if (discovered.length >= limit) {
            break;
          }

          const normalized = normalizeLink(baseUrl, link);
          if (!normalized || seenUrls.has(normalized.url)) {
            continue;
          }

          seenUrls.add(normalized.url);
          discovered.push(normalized);
        }
      } finally {
        await page.close();
      }
    }

    return discovered;
  } finally {
    await browser.close();
  }
}

function normalizeLink(pageUrl, link) {
  if (!link || !link.href) {
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

function mergeScenarios(existingScenarios, discoveredScenarios) {
  const knownUrls = new Set();
  const merged = [];

  for (const scenario of existingScenarios) {
    const url = getScenarioUrl(scenario) || scenario.referenceUrl || '';
    if (!url || knownUrls.has(url)) {
      continue;
    }

    knownUrls.add(url);
    merged.push(scenario);
  }

  for (const scenario of discoveredScenarios) {
    if (knownUrls.has(scenario.url)) {
      continue;
    }

    knownUrls.add(scenario.url);
    merged.push({
      url: scenario.url,
      label: scenario.label
    });
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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
