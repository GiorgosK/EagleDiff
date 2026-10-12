const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { transliterate } = require('transliteration');
const { execFileSync, fork, spawn } = require('child_process');
const { createInterface } = require('readline');
const { stripVTControlCharacters } = require('util');

const puppeteer = require('puppeteer-core');
const captureScreenshot = require('./capture-screenshot');
const { navigate } = require('./navigation');
const { applyCookies } = require('./cookies');
const { withRetryTimeouts, retryTimeoutFactor } = require('./retry-timeouts');
const { readResults } = require('./results-history');
const { getConfigPath, helperDir, rootDir } = require('./config-path');

const configPath = getConfigPath();
const generatedRegConfigPath = path.join(rootDir, '.reg', 'regconfig.generated.json');
const resultsPath = path.join(rootDir, 'results.json');
const regSuitBin = path.join(helperDir, 'node_modules', 'reg-suit', 'lib', 'cli.js');
const controlledRootDir = path.join(rootDir, '.reg');
const actualCacheDir = path.join(controlledRootDir, 'actual');
const stagingRootDir = path.join(controlledRootDir, 'staging');
const stagingActualDir = path.join(stagingRootDir, 'screenshots');
const referenceDir = path.join(controlledRootDir, 'reference');
const workingDir = path.join(controlledRootDir, 'run');
const runActualDir = path.join(workingDir, 'actual');

async function main() {
  const { command, filter, addPara, clean, workers: requestedWorkers } = parseArgs(process.argv.slice(2));

  if (!command || !['reference', 'test', 'approve'].includes(command)) {
    throw new Error('Usage: node scripts/run.js <reference|test|approve>');
  }

  const startedAt = Date.now();
  const config = await readJson(configPath);
  const workers = requestedWorkers ?? config.core?.workers
    ?? (await readJson(path.join(helperDir, 'config-default.json'))).core.workers;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`Invalid workers count: ${workers}. Expected a positive integer.`);
  }
  const selectedScenarios = filterScenarios(config.scenarios || [], filter, config);
  validateScreenshotNames(selectedScenarios);

  let failed = false;
  try {
    if (command === 'approve') {
      await normalizeReferenceDir(referenceDir);
      const manifest = await readJson(path.join(workingDir, 'capture-manifest.json'));
      if (manifest.version !== 1 || typeof manifest.fullRun !== 'boolean' || !Array.isArray(manifest.fileNames)
        || !manifest.fileNames.length || manifest.fileNames.some(name => typeof name !== 'string'
          || path.basename(name) !== name || !name.endsWith('.png'))) {
        throw new Error('Invalid capture manifest. Run test again before approving.');
      }
      const fileNames = filter
        ? manifest.fileNames.filter(name => selectedScenarios.scenarios.some(scenario =>
          selectedScenarios.viewports.some(viewport => getScreenshotFileName(scenario, viewport) === name)))
        : manifest.fileNames;
      await promoteActualsToReferences(runActualDir, referenceDir, null, {
        overwriteAll: manifest.fullRun && !filter, fileNames
      });
      return;
    }

    if (clean) {
      await fsp.rm(actualCacheDir, { recursive: true, force: true });
    }

    const captureBaseUrl = getCaptureBaseUrl(config, command);
    await fsp.rm(workingDir, { recursive: true, force: true });
    await fsp.rm(stagingRootDir, { recursive: true, force: true });
    await fsp.mkdir(actualCacheDir, { recursive: true });
    await fsp.mkdir(path.dirname(generatedRegConfigPath), { recursive: true });
    await fsp.writeFile(generatedRegConfigPath, `${JSON.stringify(buildRegSuitConfig(config), null, 2)}\n`);
    await normalizeReferenceDir(referenceDir);

    if (workers > 1) {
      await captureScreenshotsInWorkers({
        command,
        config,
        scenarios: selectedScenarios,
        actualDir: actualCacheDir,
        baseUrl: captureBaseUrl,
        addPara,
        workers,
        parallel: true
      });
    }
    else {
      let browser = await puppeteer.launch({
        ...buildBrowserLaunchOptions(config)
      });

      try {
        await captureScreenshots(browser, config, selectedScenarios, actualCacheDir, captureBaseUrl, addPara, command, {
          relaunchBrowser: async () => {
            await browser.close().catch(() => {});
            browser = await puppeteer.launch(buildBrowserLaunchOptions(config));
            return browser;
          }
        });
      } finally {
        await browser.close();
      }
    }

    if (command === 'reference') {
      if (clean && !filter) {
        await fsp.rm(referenceDir, { recursive: true, force: true });
      }

      await promoteActualsToReferences(actualCacheDir, referenceDir, selectedScenarios, { overwriteAll: false });
      return;
    }

    await fsp.rm(stagingActualDir, { recursive: true, force: true });
    await fsp.mkdir(stagingActualDir, { recursive: true });
    await stageActuals(actualCacheDir, stagingActualDir, selectedScenarios);
    await populateExpectedSnapshots(workingDir, referenceDir, selectedScenarios, filter);
    await runRegSuit(['compare', '--config', generatedRegConfigPath]);
    const compareResult = await readCompareResult();
    await fsp.writeFile(path.join(workingDir, 'capture-manifest.json'), JSON.stringify({
      version: 1, fullRun: !filter,
      fileNames: selectedScenarios.scenarios.flatMap(scenario =>
        selectedScenarios.viewports.map(viewport => getScreenshotFileName(scenario, viewport)))
    }) + '\n');
    try {
      const previousResults = await readResults(resultsPath);
      const entry = buildResultEntry({
        config,
        compareResult,
        selectedScenarios,
        viewports: config.viewports || [],
        workers,
        durationMs: Date.now() - startedAt
      });
      await prependJsonArrayEntry(resultsPath, entry);
      printResultsComparison(entry, Array.isArray(previousResults) ? previousResults[0] : null);
      const differences = ['failedItems', 'newItems', 'deletedItems']
        .reduce((total, key) => total + (compareResult[key]?.length || 0), 0);
      if (differences) {
        failed = true;
        process.exitCode = 1;
        console.error(`[eaglediff] ${differences} visual difference(s). Review the comparison report before approving.`);
      }
    } catch (error) {
      throw new Error(`Comparison completed, but failed to save results history to ${resultsPath}:\n${error.message}`, { cause: error });
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (command === 'reference' || command === 'test') {
      console.log(`[eaglediff] ${command} ${failed ? 'failed' : 'completed'} in ${formatDuration(Date.now() - startedAt)}`);
    }
  }
}

async function captureScreenshots(browser, config, scenarios, actualDir, baseUrl, addPara, command, options = {}) {
  validateScreenshotNames(scenarios);
  const reportWarning = options.warningReporter || require('./warnings').createWarningReporter();
  const defaultDelayMs = Number(config.defaults?.delay || 0);
  const waitUntil = config.defaults?.waitUntil || 'networkidle2';
  const fullPage = config.defaults?.fullPage !== false;
  const temporaryErrorRetries = Math.max(0, Number(config.core?.temporaryErrorRetries || 0) || 0);
  const runtimeConfig = options.parallel
    ? {
        ...config,
        defaults: {
          ...config.defaults,
          readyTimeout: Math.max(Number(config.defaults?.readyTimeout || 10000), 30000),
          waitUntilGoneTimeout: Math.max(Number(config.defaults?.waitUntilGoneTimeout || 10000), 30000)
        }
      }
    : config;
  const globalBeforeScripts = normalizeScriptList(config.onBeforeScript);
  const globalReadyScripts = normalizeScriptList(config.onReadyScript);
  const totalScreenshots = scenarios.viewports.length * scenarios.scenarios.length;
  let currentScreenshot = 0;
  const reportProgress = typeof options.progressReporter === 'function' ? options.progressReporter : null;

  for (const viewport of scenarios.viewports) {
    for (const scenario of scenarios.scenarios) {
      currentScreenshot += 1;
      const fileName = getScreenshotFileName(scenario, viewport);
      const filePath = path.join(actualDir, fileName);
      const url = buildScenarioUrl(baseUrl, command === 'reference' ? getScenarioReferenceUrl(scenario) : getScenarioUrl(scenario));
      const beforeScripts = [...globalBeforeScripts, ...normalizeScriptList(scenario.onBeforeScript)];
      const readyScripts = [...globalReadyScripts, ...normalizeScriptList(scenario.onReadyScript)];
      const readySelector = scenario.readySelector || runtimeConfig.defaults?.readySelector;
      const readyTimeout = scenario.readyTimeout || runtimeConfig.defaults?.readyTimeout;
      const delayMs = scenario.delay ?? defaultDelayMs;
      const captureContext = { scenario, mode: 'ready', config: runtimeConfig, readySelector, readyTimeout, reportWarning };

      const progressEvent = {
        current: currentScreenshot,
        total: totalScreenshots,
        scenarioLabel: getScenarioLabel(scenario),
        viewportLabel: viewport.label,
        workerId: options.workerId || null
      };

      if (reportProgress) {
        reportProgress(progressEvent);
      } else {
        const workerTag = options.workerId ? ` [w${options.workerId}]` : '';
        process.stdout.write(`[${currentScreenshot}/${totalScreenshots}]${workerTag} ${progressEvent.scenarioLabel} @ ${progressEvent.viewportLabel}\n`);
      }

      try {
        await captureScenarioScreenshot({
          browser,
          viewport,
          url,
          waitUntil: scenario.waitUntil ?? waitUntil,
          delayMs,
          beforeScripts,
          readyScripts,
          captureContext,
          runtimeConfig,
          scenario,
          addPara,
          command,
          filePath,
          fullPage,
          temporaryErrorRetries,
          relaunchBrowser: options.relaunchBrowser ? async () => {
            browser = await options.relaunchBrowser();
            return browser;
          } : null
        });
      } catch (error) {
        const worker = options.workerId ? ` [w${options.workerId}]` : '';
        throw new Error(`Capture failed${worker}: ${getScenarioLabel(scenario)} @ ${viewport.label} (${viewport.width}x${viewport.height})\nPage URL: ${url}\n${error.message}`, { cause: error });
      }
    }
  }
}

async function captureScenarioScreenshot({
  browser,
  viewport,
  url,
  waitUntil,
  delayMs,
  beforeScripts,
  readyScripts,
  captureContext,
  runtimeConfig,
  scenario,
  addPara,
  command,
  filePath,
  fullPage,
  temporaryErrorRetries,
  relaunchBrowser
}) {
  let attempt = 0;

  while (true) {
    const { config: attemptConfig, scenario: attemptScenario } = withRetryTimeouts(runtimeConfig, scenario, attempt);
    let browserContext;
    let activePage;
    const readyContext = {
      ...captureContext,
      config: attemptConfig,
      scenario: attemptScenario,
      readyTimeout: attemptScenario.readyTimeout ?? attemptConfig.defaults?.readyTimeout,
      navigationResponseStatus: null,
      navigationResponseUrl: null,
      navigationResponseOk: null
    };
    const trackNavigationResponse = response => {
      const request = response.request();
      if (!request.isNavigationRequest() || request.frame() !== activePage.mainFrame()) return;
      if (response.status() >= 300 && response.status() < 400) return;
      readyContext.navigationResponseStatus = response.status();
      readyContext.navigationResponseUrl = response.url();
      readyContext.navigationResponseOk = response.ok();
    };
    // Browser-verification pages can reload after goto has already returned.
    try {
      if (!browser.connected && relaunchBrowser) browser = await relaunchBrowser();
      browserContext = await browser.createBrowserContext();
      activePage = await browserContext.newPage();
      activePage.on('response', trackNavigationResponse);
      await activePage.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1
      });
      await applyCookies(browserContext, url, attemptScenario, attemptConfig.defaults, configPath, captureContext.reportWarning);
      await runScripts(activePage, beforeScripts, { scenario: attemptScenario, mode: 'before', config: attemptConfig });
      const navigationTimeout = attemptScenario.navigationTimeout ?? attemptConfig.defaults?.navigationTimeout ?? 30000;
      if (!Number.isFinite(navigationTimeout) || navigationTimeout < 0) {
        throw new Error('navigationTimeout must be a non-negative number of milliseconds.');
      }
      const navigationResponse = await navigate(activePage, url, { waitUntil, timeout: navigationTimeout });
      if (readyContext.navigationResponseStatus === null && navigationResponse) {
        trackNavigationResponse(navigationResponse);
      }
      if (delayMs) {
        await sleep(delayMs);
      }

      const keepScripts = readyScripts.filter(script =>
        resolveScriptPath(script) === path.join(helperDir, 'scripts', 'hooks', 'keep-selectors.js'));
      await runScripts(activePage, readyScripts.filter(script => !keepScripts.includes(script)), readyContext);
      await applyHideAndRemoveSelectors(activePage, attemptScenario, attemptConfig);
      await runAddParagraph(activePage, attemptScenario, attemptConfig, addPara, command);

      // Late content and final DOM changes can request additional font faces.
      // Recheck configured font readiness immediately before rendering.
      const fontScripts = readyScripts.filter(script =>
        resolveScriptPath(script) === path.join(helperDir, 'scripts', 'hooks', 'wait-for-fonts.js'));
      await runScripts(activePage, fontScripts, readyContext);
      await runScripts(activePage, keepScripts, readyContext);

      const screenshotOptions = {
        path: filePath,
        fullPage: scenario.fullPage !== undefined ? scenario.fullPage : fullPage
      };

      if (readyContext.keepSelectorsClip) {
        screenshotOptions.fullPage = false;
        screenshotOptions.clip = normalizeClip(readyContext.keepSelectorsClip);
        screenshotOptions.captureBeyondViewport = true;
      }

      await captureScreenshot(activePage, screenshotOptions);
      return;
    } catch (error) {
      const retryable = attempt < temporaryErrorRetries && isTemporaryCaptureError(error);

      if (!retryable) {
        const finalUrl = activePage?.url();
        if (finalUrl && finalUrl !== 'about:blank' && finalUrl !== url) {
          throw new Error(`Final page URL: ${finalUrl}\n${error.message}`, { cause: error });
        }
        throw error;
      }

      attempt += 1;
      console.warn(`[eaglediff] Temporary capture error on ${getScenarioLabel(scenario)} @ ${viewport.label}; retrying ${attempt}/${temporaryErrorRetries}\nPage URL: ${url}\n${error.message}`);
      const factor = retryTimeoutFactor(runtimeConfig, attempt);
      if (factor > 1) console.warn(`[eaglediff] Retry readiness timeouts: ${factor}x the configured budgets; worker count unchanged.`);
    } finally {
      activePage?.off('response', trackNavigationResponse);
      await safeClosePage(activePage);
      await browserContext?.close().catch(() => {});
    }
  }
}

async function safeClosePage(page) {
  if (!page) {
    return;
  }

  try {
    await page.close();
  } catch (error) {
    // Ignore close errors during recovery.
  }
}

function isTemporaryCaptureError(error) {
  // Hooks wrap errors with a cause; retain the distinction between a slow
  // resource and a broken image/HTTP error when deciding whether to retry.
  for (let cause = error; cause; cause = cause.cause) {
    if (['EAGLEDIFF_NAVIGATION_TIMEOUT', 'EAGLEDIFF_IMAGE_TIMEOUT', 'EAGLEDIFF_READY_TIMEOUT', 'EAGLEDIFF_SCROLL_TIMEOUT', 'EAGLEDIFF_FONT_TIMEOUT', 'EAGLEDIFF_FONT_LOAD'].includes(cause.code)) return true;
  }
  const message = String(error?.message || error || '');
  return /ERR_NETWORK_CHANGED|net::ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_CERT_COMMON_NAME_INVALID|net::ERR_CERT_COMMON_NAME_INVALID|ERR_CERT_AUTHORITY_INVALID|net::ERR_CERT_AUTHORITY_INVALID|Runtime\.callFunctionOn timed out|Protocol error[^\n]*: (?:Target|Session|Connection) closed|Connection closed\.|Navigation failed because browser has disconnected/i.test(message);
}

function buildBrowserLaunchOptions(config = {}) {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    ignoreHTTPSErrors: true,
    executablePath: resolveChromePath(),
    headless: true
  };

  const protocolTimeout = Number(config.core?.protocolTimeout);
  if (Number.isFinite(protocolTimeout) && protocolTimeout > 0) {
    launchOptions.protocolTimeout = protocolTimeout;
  }

  return launchOptions;
}

function resolveChromePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const resolved = execFileSync('bash', [
      '-lc',
      'command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser'
    ], { encoding: 'utf8' }).trim();

    if (resolved) {
      return resolved;
    }
  } catch (error) {
    // Fall through to the final error below.
  }

  throw new Error('No Chrome/Chromium executable found. Set CHROME_BIN or PUPPETEER_EXECUTABLE_PATH.');
}

function getCaptureBaseUrl(scenarios, mode) {
  const referenceBaseUrl = (scenarios.referenceBaseURL || '').replace(/\/$/, '');
  const testBaseUrl = (scenarios.testBaseURL || '').replace(/\/$/, '');

  if (mode === 'reference') {
    return referenceBaseUrl;
  }

  if (mode === 'test' || mode === 'approve') {
    return testBaseUrl;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

function buildScenarioUrl(baseUrl, scenarioUrl) {
  const trimmedBaseUrl = baseUrl.replace(/\/$/, '');
  if (!scenarioUrl) {
    return trimmedBaseUrl;
  }

  if (/^https?:\/\//i.test(scenarioUrl)) {
    return scenarioUrl;
  }

  return `${trimmedBaseUrl}${scenarioUrl.startsWith('/') ? scenarioUrl : `/${scenarioUrl}`}`;
}

function getScenarioUrl(scenario) {
  return scenario.url || scenario.referenceUrl || '';
}

function getScenarioReferenceUrl(scenario) {
  return scenario.referenceUrl || scenario.url || '';
}

function getScenarioLabel(scenario) {
  if (scenario.label) {
    return scenario.label;
  }

  const source = scenario.url || scenario.referenceUrl || '';
  const label = String(source)
    .replace(/^\/+/, '')
    .replace(/\/+/g, ' ')
    .trim();

  return label || 'scenario';
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getScreenshotFileName(scenario, viewport) {
  const url = getScenarioUrl(scenario) || '/';
  let readableUrl = url;
  try {
    readableUrl = decodeURI(url);
  } catch {
    // Keep malformed percent escapes readable without losing URL identity.
  }
  const name = slugify(transliterate(readableUrl)).slice(0, 120) || 'homepage';
  const viewportName = slugify(transliterate(String(viewport.label || 'viewport'))).slice(0, 32) || 'viewport';
  // Hash the original URL, not its lossy transliteration, and include viewport geometry.
  const identity = JSON.stringify([url, viewport.label, viewport.width, viewport.height, viewport.deviceScaleFactor || 1]);
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${name}--${hash}__${viewportName}.png`;
}

function validateScreenshotNames(selection) {
  const names = new Set();
  for (const scenario of selection.scenarios) {
    for (const viewport of selection.viewports || []) {
      const name = getScreenshotFileName(scenario, viewport);
      if (names.has(name)) {
        throw new Error(`Duplicate screenshot identity for URL ${getScenarioUrl(scenario)} at viewport ${viewport.label}. Remove duplicate scenarios/viewports or give variants distinct URLs/viewports.`);
      }
      names.add(name);
    }
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

async function readCompareResult() {
  const raw = await fsp.readFile(path.join(workingDir, 'out.json'), 'utf8');
  return JSON.parse(raw);
}

function buildResultEntry({ config, compareResult, selectedScenarios, viewports, workers, durationMs }) {
  const run = selectedScenarios.scenarios.length * viewports.length;
  const passed = Array.isArray(compareResult?.passedItems) ? compareResult.passedItems.length : 0;

  return {
    datetime: formatDateTimeStamp(new Date()),
    ref: config.referenceBaseURL || '',
    test: config.testBaseURL || '',
    run,
    passed,
    dur_sec: Math.max(0, Math.round(durationMs / 1000)),
    workers
  };
}

async function prependJsonArrayEntry(filePath, entry) {
  const existing = await readResults(filePath);
  const entries = Array.isArray(existing) ? existing : [];
  entries.unshift(entry);
  await fsp.writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

function printResultsComparison(currentEntry, previousEntry) {
  console.log(`[results] current  ${formatResultLine(currentEntry)}`);
  if (previousEntry) {
    console.log(`[results] previous ${formatResultLine(previousEntry)}`);
  }
}

function formatResultLine(entry) {
  return `${formatDateParts(entry.datetime)} | run=${entry.run} | passed=${entry.passed} | dur=${entry.dur_sec}s | workers=${entry.workers}`;
}

function formatDateTimeStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetRemainder}`;
}

function formatDateParts(datetime) {
  const [datePart, timePart] = String(datetime || '').split('T');
  if (!datePart || !timePart) {
    return String(datetime || '');
  }

  return `${datePart.replace(/-/g, '/')} ${timePart.replace(/\+.*$/, '')}`;
}

function formatDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0] || null,
    filter: process.env.npm_config_filter || null,
    addPara: process.env.npm_config_addpara === 'true' || process.env.npm_config_addpara === '1',
    clean: true,
    workers: process.env.npm_config_workers ? Number(process.env.npm_config_workers) : undefined
  };

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];

    if (value.startsWith('--filter=')) {
      parsed.filter = value.slice('--filter='.length).trim();
    }
    else if (value === '--filter') {
      parsed.filter = (argv[index + 1] || '').trim();
      index += 1;
    }
    else if (value === '--addpara') {
      parsed.addPara = true;
    }
    else if (value.startsWith('--addpara=')) {
      parsed.addPara = value.slice('--addpara='.length) === 'true';
    }
    else if (value === '--clean') {
      parsed.clean = true;
    }
    else if (value.startsWith('--clean=')) {
      parsed.clean = value.slice('--clean='.length) === 'true';
    }
    else if (value === '--no-clean') {
      parsed.clean = false;
    }
    else if (value === '--workers') {
      parsed.workers = Number(argv[index + 1] || 1);
      index += 1;
    }
    else if (value.startsWith('--workers=')) {
      parsed.workers = Number(value.slice('--workers='.length));
    }
  }

  if (parsed.workers !== undefined && (!Number.isInteger(parsed.workers) || parsed.workers < 1)) {
    throw new Error(`Invalid workers count: ${parsed.workers}`);
  }

  return parsed;
}

function buildRegSuitConfig(config) {
  const core = config.core;
  const thresholdRate = core?.thresholdRate ?? 0.01;
  const matchingThreshold = core?.thresholdRateColor ?? 0;
  if (!Number.isFinite(matchingThreshold) || matchingThreshold < 0 || matchingThreshold > 1) {
    throw new Error('core.thresholdRateColor must be a number between 0 and 1.');
  }

  return {
    core: {
      workingDir,
      actualDir: path.join('.reg', 'staging', 'screenshots'),
      thresholdRate,
      matchingThreshold
    }
  };
}

async function normalizeReferenceDir(referenceDir) {
  await fsp.mkdir(referenceDir, { recursive: true });
  const entries = await fsp.readdir(referenceDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  for (const entry of entries) {
    const entryPath = path.join(referenceDir, entry.name);
    if (entry.isDirectory() && entry.name === 'expected') {
      const nestedImages = await listImageFiles(entryPath);
      for (const fileName of nestedImages) {
        await fsp.copyFile(path.join(entryPath, fileName), path.join(referenceDir, fileName));
      }
      await fsp.rm(entryPath, { recursive: true, force: true });
    }
  }

  const refreshedEntries = await fsp.readdir(referenceDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    refreshedEntries
      .filter((entry) => !entry.isFile() || !entry.name.toLowerCase().endsWith('.png'))
      .map((entry) => fsp.rm(path.join(referenceDir, entry.name), { recursive: true, force: true }))
  );
}

function filterScenarios(scenarios, filter, config) {
  if (!filter) {
    return {
      ...config,
      scenarios
    };
  }

  const terms = filter
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);

  const selected = scenarios.filter((scenario) => {
    const values = [
      getScenarioLabel(scenario),
      scenario.url,
      scenario.referenceUrl,
      buildScenarioUrl(config.referenceBaseURL || '', getScenarioReferenceUrl(scenario)),
      buildScenarioUrl(config.testBaseURL || '', getScenarioUrl(scenario))
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return terms.some((term) => values.some((value) => value.includes(term.toLowerCase())));
  });

  if (selected.length === 0) {
    throw new Error(`No scenarios matched filter: ${filter}`);
  }

  return {
    ...config,
    filter,
    scenarios: selected
  };
}

function applyHideAndRemoveSelectors(page, scenario, config) {
  const hideSelectors = [
    ...normalizeScriptList(config.defaults?.hideSelectors),
    ...normalizeScriptList(scenario.hideSelectors)
  ];
  const removeSelectors = [
    ...normalizeScriptList(config.defaults?.removeSelectors),
    ...normalizeScriptList(scenario.removeSelectors)
  ];

  return (async () => {
    for (const selector of hideSelectors) {
      await hideSelector(page, selector);
    }

    for (const selector of removeSelectors) {
      await removeSelector(page, selector);
    }
  })();
}

async function runAddParagraph(page, scenario, config, addPara, command) {
  if (command !== 'test' || !addPara || !scenario.addParagraph) {
    return;
  }

  const hookConfig = {
    scenario,
    config,
    mode: 'ready'
  };

  const hook = require('./hooks/add-paragraph');
  await hook(page, hookConfig);
}

async function hideSelector(page, selector) {
  await page.addStyleTag({
    content: `${selector}{visibility:hidden!important;}`
  });
}

async function removeSelector(page, selector) {
  await page.evaluate((currentSelector) => {
    document.querySelectorAll(currentSelector).forEach((element) => element.remove());
  }, selector);
}

function normalizeScriptList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function populateExpectedSnapshots(workingDir, referenceDir, selection, filter) {
  const expectedDir = path.join(workingDir, 'expected');
  const keepNames = new Set(
    selection.scenarios.flatMap((scenario) => selection.viewports.map((viewport) => getScreenshotFileName(scenario, viewport)))
  );

  await fsp.rm(expectedDir, { recursive: true, force: true });
  await fsp.mkdir(expectedDir, { recursive: true });

  const fileNames = await listImageFiles(referenceDir);
  const namesToCopy = filter
    ? fileNames.filter((fileName) => keepNames.has(fileName))
    : fileNames;

  for (const fileName of namesToCopy) {
    await fsp.copyFile(path.join(referenceDir, fileName), path.join(expectedDir, fileName));
  }
}

async function directoryExists(directoryPath) {
  try {
    const stats = await fsp.stat(directoryPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

async function listImageFiles(directoryPath) {
  try {
    return (await fsp.readdir(directoryPath))
      .filter((fileName) => fileName.toLowerCase().endsWith('.png'))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function stageActuals(actualDir, stageActualDir, scenarios) {
  const selectedFileNames = scenarios.scenarios.flatMap((scenario) =>
    scenarios.viewports.map((viewport) => getScreenshotFileName(scenario, viewport))
  );

  for (const fileName of selectedFileNames) {
    const sourcePath = path.join(actualDir, fileName);
    const destinationPath = path.join(stageActualDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing actual screenshot: ${sourcePath}`);
    }

    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    await fsp.copyFile(sourcePath, destinationPath);
  }
}

function normalizeClip(clip) {
  return {
    x: Math.max(0, Math.floor(clip.x)),
    y: Math.max(0, Math.floor(clip.y)),
    width: Math.max(1, Math.ceil(clip.width)),
    height: Math.max(1, Math.ceil(clip.height))
  };
}

async function promoteActualsToReferences(actualDir, expectedDir, scenarios, options) {
  const fileNames = await getSelectedActualFileNames(actualDir, scenarios, options);

  if (fileNames.length === 0) {
    throw new Error(`No screenshots found in ${path.relative(rootDir, actualDir)}`);
  }

  // Validate every source before modifying any baseline.
  for (const fileName of fileNames) {
    const image = await fsp.readFile(path.join(actualDir, fileName));
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`Invalid actual screenshot: ${fileName}`);
    }
  }

  if (options.overwriteAll) {
    await fsp.rm(expectedDir, { recursive: true, force: true });
  }

  await fsp.mkdir(expectedDir, { recursive: true });

  for (const fileName of fileNames) {
    const sourcePath = path.join(actualDir, fileName);
    const destinationPath = path.join(expectedDir, fileName);
    await fsp.copyFile(sourcePath, destinationPath);
  }

  console.log(
    `[eaglediff] Promoted ${fileNames.length} screenshots from ${path.relative(rootDir, actualDir)} to ${path.relative(rootDir, expectedDir)}`
  );
}

async function getSelectedActualFileNames(actualDir, scenarios, options = {}) {
  if (options.fileNames) return options.fileNames;
  if (options.overwriteAll) {
    return listImageFiles(actualDir);
  }

  if (!scenarios || !scenarios.scenarios || !scenarios.viewports) {
    return listImageFiles(actualDir);
  }

  const selectedFileNames = scenarios.scenarios.flatMap((scenario) =>
    scenarios.viewports.map((viewport) => getScreenshotFileName(scenario, viewport))
  );

  if (selectedFileNames.length === 0) {
    return listImageFiles(actualDir);
  }

  return selectedFileNames;
}

async function captureScreenshotsInWorkers({ command, config, scenarios, actualDir, baseUrl, addPara, workers }) {
  const captureBatches = partitionCaptures(scenarios, workers);
  const totalScreenshots = scenarios.scenarios.length * scenarios.viewports.length;
  let completedScreenshots = 0;
  const workerPath = path.join(__dirname, 'capture-worker.js');
  const children = [];
  const reportWarning = require('./warnings').createWarningReporter();
  let aborted = false;

  try {
    await Promise.all(
    captureBatches.map((captures, index) => new Promise((resolve, reject) => {
      const workerId = index + 1;
      const child = fork(workerPath, [], {
        cwd: rootDir,
        env: process.env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
      });
      children.push(child);
      let settled = false;

      const fail = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      child.on('message', (message) => {
        if (aborted || !message || typeof message !== 'object') {
          return;
        }

        if (message.type === 'warning') {
          reportWarning(message.code, message.message);
          return;
        }

        if (message.type === 'progress') {
          completedScreenshots += 1;
          const workerTag = captureBatches.length > 1 ? ` [w${workerId}]` : '';
          console.log(`[${completedScreenshots}/${totalScreenshots}]${workerTag} ${message.scenarioLabel} @ ${message.viewportLabel}`);
          return;
        }

        if (message.type === 'error') {
          fail(new Error(message.message || `Worker ${workerId} failed`));
        }
      });

      child.on('error', fail);
      child.on('exit', (code) => {
        if (settled) {
          return;
        }

        settled = true;

        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`Worker ${workerId} exited with code ${code}`));
      });

      child.send({
        command,
        config,
        captures,
        actualDir,
        baseUrl,
        addPara,
        workerId
      });
    }))
    );
  } catch (error) {
    aborted = true;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    throw new Error(`${error.message}\nCapture run stopped after a failure; remaining workers were cancelled.`, { cause: error });
  }
}

function partitionCaptures(selection, workerCount) {
  const captures = selection.viewports.flatMap(viewport =>
    selection.scenarios.map(scenario => ({ scenario, viewport }))
  );
  const batchCount = Math.min(Math.max(1, Math.floor(workerCount)), captures.length);
  const batches = Array.from({ length: batchCount }, () => []);

  captures.forEach((capture, index) => {
    batches[index % batchCount].push(capture);
  });

  return batches;
}

async function runScripts(page, scriptSpecs, context) {
  for (const scriptSpec of scriptSpecs) {
    try {
      const scriptPath = resolveScriptPath(scriptSpec);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const script = require(scriptPath);
      const runner = typeof script === 'function' ? script : script.run;

      if (typeof runner !== 'function') {
        throw new Error(`Hook must export a function: ${scriptPath}`);
      }

      await runner(page, context);
    } catch (error) {
      throw new Error(`Hook: ${scriptSpec}\n${error.message}`, { cause: error });
    }
  }
}

function resolveScriptPath(scriptSpec) {
  const raw = String(scriptSpec);
  const relativePath = raw.endsWith('.js') ? raw : `${raw}.js`;

  if (path.isAbsolute(raw) || raw.startsWith('.')) {
    return path.isAbsolute(relativePath) ? relativePath : path.join(rootDir, relativePath);
  }

  if (raw.startsWith('scripts/') || raw.startsWith('hooks/')) {
    return path.join(helperDir, 'scripts', relativePath);
  }

  return path.join(helperDir, 'scripts', relativePath);
}

function runRegSuit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [regSuitBin, ...args], { stdio: ['inherit', 'pipe', 'inherit'], cwd: rootDir, shell: false });
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.on('line', (line) => {
      // Eaglediff supplies local references directly; snapshot-key discovery is unused.
      if (stripVTControlCharacters(line).trim() === '[reg-suit] info Skipped to detect the previous snapshot key because key generator plugin is not set up.') return;
      process.stdout.write(`${line}\n`);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`reg-suit ${args[0]} failed with exit code ${code}`));
    });
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  captureScreenshots,
  resolveChromePath,
  buildBrowserLaunchOptions,
  buildScenarioUrl,
  getScenarioLabel,
  getScenarioUrl,
  getScreenshotFileName,
  validateScreenshotNames,
  slugify
};
