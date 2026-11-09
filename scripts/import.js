const reportError = require('./cli-error');
const fsp = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { getScenarioUrl, validateScreenshotNames } = require('./run');

const { getConfigPath, helperDir, rootDir } = require('./config-path');

const defaultConfigPath = path.join(helperDir, 'config-default.json');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backstopPath = resolveBackstopManifestPath(args.backstop);
  const backstopConfig = await readJson(backstopPath);
  const configPath = getConfigPath();
  const templateConfig = await readJson(defaultConfigPath);
  const existingConfig = await readJsonIfExists(configPath);
  const baseConfig = mergeDeep(templateConfig, existingConfig || {});
  const duplicates = [];
  const importedConfig = buildImportedConfig(baseConfig, templateConfig, backstopConfig, backstopPath,
    configPath, {
      preserveWorkers: Object.hasOwn(existingConfig?.core || {}, 'workers'),
      onDuplicate: duplicate => duplicates.push(duplicate)
    });

  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, `${JSON.stringify(importedConfig, null, 2)}\n`);
  await ensureGitignore(path.dirname(configPath));

  for (const { url, labels, ids } of duplicates) {
    const details = labels.map((label, index) => `${JSON.stringify(label)}${ids?.[index] !== undefined ? ` (id: ${JSON.stringify(ids[index])})` : ''}`);
    const explanation = new Set(labels).size < labels.length ? '; repeated labels use unique IDs' : ' with distinct labels';
    console.warn(`[eaglediff] Duplicate URL ${JSON.stringify(url)}: kept ${labels.length} scenarios${explanation}: ${details.join(', ')}.`);
  }

  const scenarioCount = Array.isArray(importedConfig.scenarios) ? importedConfig.scenarios.length : 0;
  console.log(`[eaglediff] Imported ${scenarioCount} scenarios from ${backstopPath}`);
  console.log(`[eaglediff] Wrote ${path.relative(rootDir, configPath)}`);
}

function buildImportedConfig(baseConfig, templateConfig, backstopConfig, backstopPath,
  configPath = getConfigPath(), { preserveWorkers = false, onDuplicate = () => {} } = {}) {
  const scenarios = (Array.isArray(backstopConfig.scenarios) ? backstopConfig.scenarios : []).map(scenario => {
    if (!scenario || typeof scenario !== 'object') return scenario;
    const cookiePath = Object.hasOwn(scenario, 'cookiePath') ? scenario.cookiePath : backstopConfig.cookiePath;
    return {
      ...scenario,
      ...(cookiePath !== undefined ? { cookiePath: cookiePath ? path.relative(path.dirname(configPath),
        path.resolve(path.dirname(backstopPath), cookiePath)) : null } : {})
    };
  });
  const referenceBaseURL = deriveBaseUrl(scenarios, 'referenceUrl')
    || baseConfig.referenceBaseURL
    || baseConfig.testBaseURL;
  const testBaseURL = deriveBaseUrl(scenarios, 'url')
    || baseConfig.testBaseURL
    || baseConfig.referenceBaseURL;

  if (!referenceBaseURL || !testBaseURL) {
    throw new Error(`Unable to derive base URLs from ${path.relative(rootDir, backstopPath)}. Add absolute scenario URLs or create the config with the existing \`config\` command first.`);
  }

  const sharedDefaults = buildSharedDefaults(scenarios, {
    delay: baseConfig.defaults?.delay,
    readySelector: baseConfig.defaults?.readySelector,
    readyVisible: baseConfig.defaults?.readyVisible,
    cookieConsent: baseConfig.defaults?.cookieConsent,
    cookieConsentTimeout: baseConfig.defaults?.cookieConsentTimeout,
    videoCaptureMode: baseConfig.defaults?.videoCaptureMode,
    freezeWebAnimations: baseConfig.defaults?.freezeWebAnimations,
    waitForJQueryReady: baseConfig.defaults?.waitForJQueryReady,
    jqueryReadyTimeout: baseConfig.defaults?.jqueryReadyTimeout,
    waitForDrupalReady: baseConfig.defaults?.waitForDrupalReady,
    drupalReadyTimeout: baseConfig.defaults?.drupalReadyTimeout,
    readyTimeout: baseConfig.defaults?.readyTimeout,
    waitUntil: baseConfig.defaults?.waitUntil,
    navigationTimeout: baseConfig.defaults?.navigationTimeout,
    cookiePath: baseConfig.defaults?.cookiePath,
    cookies: baseConfig.defaults?.cookies,
    waitUntilGone: baseConfig.defaults?.waitUntilGone,
    waitUntilGoneTimeout: baseConfig.defaults?.waitUntilGoneTimeout,
    fullPage: baseConfig.defaults?.fullPage,
    http404Policy: baseConfig.defaults?.http404Policy,
    captureBeyondViewport: baseConfig.defaults?.captureBeyondViewport,
    waitForIframes: baseConfig.defaults?.waitForIframes,
    iframeTimeout: baseConfig.defaults?.iframeTimeout,
    carouselSelectors: baseConfig.defaults?.carouselSelectors,
    carouselSettleDelayMs: baseConfig.defaults?.carouselSettleDelayMs,
    keepSelectors: baseConfig.defaults?.keepSelectors,
    hideSelectors: baseConfig.defaults?.hideSelectors,
    hideDynamicSelectors: baseConfig.defaults?.hideDynamicSelectors,
    removeSelectors: baseConfig.defaults?.removeSelectors
  });
  const thresholdRate = deriveThresholdRate(scenarios, baseConfig.core?.thresholdRate);
  const translatedScenarios = normalizeScenarios(scenarios, referenceBaseURL, testBaseURL, sharedDefaults);
  resolveDuplicateScenarios(translatedScenarios, onDuplicate);
  const captureLimit = Number(backstopConfig.asyncCaptureLimit);

  const importedConfig = {
    ...baseConfig,
    referenceBaseURL,
    testBaseURL,
    core: {
      ...baseConfig.core,
      ...(!preserveWorkers && Number.isInteger(captureLimit) && captureLimit > 0
        ? { workers: captureLimit } : {}),
      ...(thresholdRate === null ? {} : { thresholdRate })
    },
    defaults: {
      ...baseConfig.defaults,
      ...sharedDefaults
    },
    onBeforeScript: translateScriptConfig(backstopConfig.onBeforeScript, templateConfig.onBeforeScript),
    onReadyScript: translateScriptConfig(backstopConfig.onReadyScript, templateConfig.onReadyScript),
    viewports: Array.isArray(backstopConfig.viewports) ? backstopConfig.viewports : baseConfig.viewports,
    scenarios: translatedScenarios
  };
  validateScreenshotNames(importedConfig);
  return importedConfig;
}

function normalizeScenarios(scenarios, referenceBaseURL, testBaseURL, defaults = {}) {
  const normalized = [];

  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') {
      continue;
    }

    const referenceUrl = normalizeScenarioUrl(scenario.referenceUrl || scenario.url, referenceBaseURL);
    const url = normalizeScenarioUrl(scenario.url || scenario.referenceUrl, testBaseURL);
    normalized.push(stripScenarioToRunnerShape({
      id: scenario.id,
      label: scenario.label,
      url,
      ...(referenceUrl !== url ? { referenceUrl } : {}),
      ...pickScenarioOverrides(scenario, defaults)
    }));
  }

  return normalized;
}

function resolveDuplicateScenarios(scenarios, onDuplicate) {
  const groups = new Map();
  for (const scenario of scenarios) {
    const url = getScenarioUrl(scenario) || '/';
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url).push(scenario);
  }
  for (const [url, variants] of groups) {
    if (variants.length < 2) continue;
    const labels = variants.map(scenario => String(scenario.label || ''));
    const byLabel = new Map();
    for (const [index, scenario] of variants.entries()) {
      const label = labels[index];
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(scenario);
    }
    for (const sameLabel of byLabel.values()) {
      if (sameLabel.length < 2) continue;
      const used = new Set(sameLabel.filter(scenario => scenario.id !== undefined).map(scenario => scenario.id));
      const retained = new Set();
      for (const scenario of sameLabel) {
        if (scenario.id !== undefined && !retained.has(scenario.id)) {
          retained.add(scenario.id);
          continue;
        }
        const content = { ...scenario, id: undefined };
        const baseId = `variant-${createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12)}`;
        let id = baseId;
        for (let suffix = 2; used.has(id); suffix += 1) id = `${baseId}-${suffix}`;
        scenario.id = id;
        used.add(id);
      }
    }
    onDuplicate({ url, labels, ...(variants.some(scenario => scenario.id !== undefined) ? { ids: variants.map(scenario => scenario.id) } : {}) });
  }
}

function stripScenarioToRunnerShape(scenario) {
  const keepKeys = new Set([
    'id',
    'label',
    'url',
    'referenceUrl',
    'delay',
    'readySelector',
    'readyTimeout',
    'readyVisible',
    'cookieConsent',
    'cookieConsentTimeout',
    'videoCaptureMode',
    'freezeWebAnimations',
    'waitForJQueryReady',
    'jqueryReadyTimeout',
    'waitForDrupalReady',
    'drupalReadyTimeout',
    'waitUntil',
    'navigationTimeout',
    'cookiePath',
    'cookies',
    'waitUntilGone',
    'waitUntilGoneTimeout',
    'fullPage',
    'http404Policy',
    'captureBeyondViewport',
    'waitForIframes',
    'iframeTimeout',
    'carouselSelectors',
    'carouselSettleDelayMs',
    'keepSelectors',
    'hideSelectors',
    'hideDynamicSelectors',
    'removeSelectors',
    'addParagraph',
    'addParagraphText',
    'addParagraphSelector',
    'addParagraphTarget'
  ]);

  return Object.fromEntries(
    Object.entries(scenario).filter(([key, value]) => keepKeys.has(key) && value !== undefined)
  );
}

function pickScenarioOverrides(scenario, defaults) {
  const candidateKeys = [
    'delay',
    'readySelector',
    'readyTimeout',
    'readyVisible',
    'cookieConsent',
    'cookieConsentTimeout',
    'videoCaptureMode',
    'freezeWebAnimations',
    'waitForJQueryReady',
    'jqueryReadyTimeout',
    'waitForDrupalReady',
    'drupalReadyTimeout',
    'waitUntil',
    'navigationTimeout',
    'cookiePath',
    'cookies',
    'waitUntilGone',
    'waitUntilGoneTimeout',
    'fullPage',
    'http404Policy',
    'captureBeyondViewport',
    'waitForIframes',
    'iframeTimeout',
    'carouselSelectors',
    'carouselSettleDelayMs',
    'keepSelectors',
    'hideSelectors',
    'hideDynamicSelectors',
    'removeSelectors',
    'addParagraph',
    'addParagraphText',
    'addParagraphSelector',
    'addParagraphTarget'
  ];

  const overrides = {};
  for (const key of candidateKeys) {
    if (!Object.prototype.hasOwnProperty.call(scenario, key)) {
      continue;
    }

    const value = scenario[key];
    if (!isSettingValue(key, value) && key !== 'cookies' && key !== 'cookiePath') {
      continue;
    }

    if (key in defaults && valuesEqual(value, defaults[key])) {
      continue;
    }

    overrides[key] = value;
  }

  return overrides;
}

function buildSharedDefaults(scenarios, fallbackDefaults) {
  const defaults = { ...fallbackDefaults };
  const sharedFields = [
    'delay',
    'readySelector',
    'readyVisible',
    'cookieConsent',
    'cookieConsentTimeout',
    'videoCaptureMode',
    'freezeWebAnimations',
    'waitForJQueryReady',
    'jqueryReadyTimeout',
    'waitForDrupalReady',
    'drupalReadyTimeout',
    'readyTimeout',
    'waitUntil',
    'navigationTimeout',
    'cookiePath',
    'cookies',
    'waitUntilGone',
    'waitUntilGoneTimeout',
    'fullPage',
    'http404Policy',
    'captureBeyondViewport',
    'waitForIframes',
    'iframeTimeout',
    'carouselSelectors',
    'carouselSettleDelayMs',
    'keepSelectors',
    'hideSelectors',
    'hideDynamicSelectors',
    'removeSelectors'
  ];

  for (const field of sharedFields) {
    const value = commonScenarioValue(scenarios, field);
    if (isSettingValue(field, value)) {
      defaults[field] = value;
    }
  }

  return defaults;
}

function deriveThresholdRate(scenarios, fallbackThresholdRate) {
  const value = commonScenarioValue(scenarios, 'misMatchThreshold');
  if (value === undefined || value === null || value === '') {
    return fallbackThresholdRate ?? null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallbackThresholdRate ?? null;
  }

  return numericValue / 100;
}

function commonScenarioValue(scenarios, key) {
  let found = false;
  let firstValue;

  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') {
      return undefined;
    }

    const value = scenario[key];
    if (!isSettingValue(key, value)) {
      return undefined;
    }

    if (!found) {
      found = true;
      firstValue = value;
      continue;
    }

    if (!valuesEqual(value, firstValue)) {
      return undefined;
    }
  }

  return found ? firstValue : undefined;
}

function isSettingValue(key, value) {
  return isMeaningfulValue(value) || (key === 'readySelector' && value === '')
    || (key === 'carouselSelectors' && Array.isArray(value) && value.length === 0);
}

function isMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return true;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function ensureGitignore(projectDir) {
  const gitignorePath = path.join(projectDir, '.gitignore');
  const desiredContent = [
    '# Generated by eaglediff',
    '.reg/',
    'results.json',
    ''
  ].join('\n');

  try {
    await fsp.access(gitignorePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await fsp.writeFile(gitignorePath, desiredContent);
  }
}

function translateScriptConfig(value, fallback) {
  const scripts = normalizeScriptList(value)
    .map((script) => String(script || '').trim())
    .filter(Boolean)
    .filter(isSupportedRunnerScript);

  if (!scripts.length) {
    return fallback;
  }

  return scripts;
}

function normalizeScriptList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isSupportedRunnerScript(script) {
  return /^hooks\/[a-z0-9-_]+(?:\.js)?$/i.test(script) || /^scripts\/hooks\/[a-z0-9-_]+(?:\.js)?$/i.test(script);
}

function normalizeScenarioUrl(rawUrl, baseUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }

  if (!/^https?:\/\//i.test(value)) {
    return value.startsWith('/') ? value : `/${value}`;
  }

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return value;
  }

  try {
    const urlObject = new URL(value);
    const baseObject = new URL(baseUrl);
    if (urlObject.origin !== baseObject.origin) {
      return value;
    }

    return `${normalizePath(urlObject.pathname)}${urlObject.search || ''}${urlObject.hash || ''}`;
  } catch (error) {
    return value;
  }
}

function normalizePath(pathname) {
  const trimmed = String(pathname || '').replace(/\/+$/, '').trim();
  return trimmed ? (trimmed.startsWith('/') ? trimmed : `/${trimmed}`) : '/';
}

function deriveBaseUrl(scenarios, key) {
  const values = scenarios
    .map((scenario) => scenario && scenario[key])
    .map((value) => String(value || '').trim())
    .filter((value) => /^https?:\/\//i.test(value));

  if (values.length === 0) {
    return '';
  }

  const counts = new Map();
  const order = [];

  for (const value of values) {
    const origin = new URL(value).origin;
    if (!counts.has(origin)) {
      counts.set(origin, 0);
      order.push(origin);
    }
    counts.set(origin, counts.get(origin) + 1);
  }

  let winner = order[0];
  let highestCount = -1;
  for (const origin of order) {
    const count = counts.get(origin) || 0;
    if (count > highestCount) {
      highestCount = count;
      winner = origin;
    }
  }

  return winner;
}

function resolveBackstopManifestPath(inputPath) {
  const rawPath = String(inputPath || '').trim();
  if (!rawPath) {
    throw new Error('Usage: eaglediff import --backstop=/path/to/backstop --dir <project-dir>');
  }

  const invocationDir = path.resolve(process.env.EAGLEDIFF_INVOCATION_DIR || process.cwd());
  const resolved = path.resolve(invocationDir, rawPath);
  if (looksLikeJsonFile(resolved)) {
    return resolved;
  }

  return path.join(resolved, 'backstop.json');
}

function looksLikeJsonFile(resolvedPath) {
  return path.extname(resolvedPath).toLowerCase() === '.json';
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
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

function parseArgs(argv) {
  const parsed = {
    backstop: process.env.npm_config_backstop || null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value || value === '--' || value === 'import') {
      continue;
    }

    if (value.startsWith('--backstop=')) {
      parsed.backstop = value.slice('--backstop='.length).trim();
    } else if (value === '--backstop') {
      parsed.backstop = (argv[index + 1] || '').trim();
      index += 1;
    }
  }

  return parsed;
}

if (require.main === module) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 1;
  });
}

module.exports = { buildImportedConfig };
