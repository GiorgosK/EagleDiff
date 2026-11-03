const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots, getScreenshotFileName } = require('../scripts/run');
const wait = require('../scripts/hooks/wait-for-element');
const { buildImportedConfig } = require('../scripts/import');
const template = require('../config-default.json');
const fixture = require('./helpers/cli-fixture');

let browser;
before(async () => { browser = await puppeteer.launch(buildBrowserLaunchOptions()); });
after(async () => { await browser?.close(); });

test('new defaults capture footer-free pages with all bundled hooks and still reject broken images', async t => {
  assert.equal(template.defaults.readySelector, '');
  const f = await fixture(t);
  const scenarios = f.config.scenarios.map(s => ({ ...s, readyTimeout: 100 }));
  const viewports = f.config.viewports;
  Object.assign(f.config, structuredClone(template), {
    referenceBaseURL: f.baseURL,
    testBaseURL: f.baseURL,
    core: { ...template.core, workers: 1, thresholdRate: 0 },
    defaults: { ...template.defaults, delay: 0, fullPage: false, scrollStepDelayMs: 20, scrollSettleDelayMs: 20, networkIdleTime: 20 },
    scenarios, viewports
  });
  await f.save();
  await f.run(['reference', '--workers=1']);
  for (const name of await f.files()) {
    const image = await fs.readFile(path.join(f.directory, '.reg/reference', name));
    assert.equal(image.readUInt32BE(16), 100);
    assert.equal(image.readUInt32BE(20), 100);
  }
  await f.run(['test', '--workers=2']);
  const report = JSON.parse(await fs.readFile(path.join(f.directory, '.reg/run/out.json')));
  assert.equal(report.passedItems.length, 2);
  assert.equal(report.failedItems.length, 0);
  f.pages['/two'] = '<img src="/missing-image.svg">';
  const failed = await f.run(['test', '--workers=2'], 1);
  assert.match(failed.stderr, /Hook: hooks\/load-lazy-images/);
  assert.match(failed.stderr, /missing-image\.svg/);
});

test('scenario empty strings disable inherited waits while defaults and legacy root fallbacks still work', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const cases = [
    { scenario: { readySelector: '.scenario' }, config: { defaults: { readySelector: '.absent' }, readySelector: '.absent-root' }, present: 'scenario' },
    { scenario: {}, config: { defaults: { readySelector: '.default' }, readySelector: '.absent-root' }, present: 'default' },
    { scenario: { readySelector: null }, config: { defaults: { readySelector: '.default' } }, present: 'default' },
    { scenario: {}, config: { defaults: { readySelector: '' }, readySelector: '.legacy' }, present: 'legacy' },
    { scenario: {}, config: { readySelector: '.legacy' }, present: 'legacy' },
    { scenario: { readySelector: '' }, config: { defaults: { readySelector: '.absent' }, readySelector: '.absent-root' }, present: 'content' },
    { scenario: {}, config: { defaults: { readySelector: '' } }, present: 'content' }
  ];
  for (const { scenario, config, present } of cases) {
    await page.setContent(`<main class="${present}">Loaded content</main>`);
    await wait(page, { scenario: { readyTimeout: 100, ...scenario }, config });
    assert.equal(await page.$eval('main', n => n.textContent), 'Loaded content');
  }
});

test('an explicit selector still waits for delayed visible content and fails when required content is missing', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<main>Loading</main>');
  await page.evaluate(() => setTimeout(() => {
    const button = document.createElement('button');
    button.id = 'ready';
    button.textContent = 'Submit';
    document.querySelector('main').replaceChildren(button);
  }, 100));
  await wait(page, { scenario: { readySelector: '#ready', readyVisible: true, readyTimeout: 2000 }, config: { defaults: { readySelector: '' } } });
  assert.equal(await page.$eval('#ready', n => n.textContent), 'Submit');
  await assert.rejects(wait(page, { scenario: { readySelector: '#missing', readyTimeout: 50 }, config: { defaults: { readySelector: '' } } }), error => {
    assert.equal(error.code, 'EAGLEDIFF_READY_TIMEOUT');
    assert.equal(error.cause.name, 'TimeoutError');
    return true;
  });
});

test('empty selectors reach custom hooks unchanged through parallel defaults and capture retries', async t => {
  const f = await fixture(t);
  const hook = path.join(f.directory, 'observe-ready.js');
  const seen = path.join(f.directory, 'seen.json');
  await fs.writeFile(hook, `module.exports = async (page, context) => {
    const fs = require('node:fs');
    const file = ${JSON.stringify(seen)};
    const states = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
    states.push({ selector: context.readySelector, scenarioSelector: context.scenario.readySelector });
    fs.writeFileSync(file, JSON.stringify(states));
    if (states.length === 1) {
      const error = new Error('Temporary readiness failure');
      error.code = 'EAGLEDIFF_READY_TIMEOUT';
      throw error;
    }
  };`);
  const scenario = { url: '/one', readySelector: '', readyTimeout: 50 };
  const config = {
    core: { temporaryErrorRetries: 1, temporaryErrorRetryTimeoutMultiplier: 2 },
    readySelector: '.missing-root', defaults: { delay: 0, fullPage: false, waitUntil: 'load', readySelector: '.missing-default' },
    onReadyScript: ['hooks/wait-for-element', hook]
  };
  const original = structuredClone({ config, scenario });
  const viewport = { label: 'small', width: 100, height: 100 };
  await captureScreenshots(browser, config, { scenarios: [scenario], viewports: [viewport] }, f.directory, f.baseURL, false, 'reference', { parallel: true });
  assert.deepEqual(JSON.parse(await fs.readFile(seen)), [
    { selector: '', scenarioSelector: '' },
    { selector: '', scenarioSelector: '' }
  ]);
  const image = await fs.readFile(path.join(f.directory, getScreenshotFileName(scenario, viewport)));
  assert.equal(image.readUInt32BE(16), 100);
  assert.equal(image.readUInt32BE(20), 100);
  assert.deepEqual({ config, scenario }, original);
});

test('Backstop import preserves empty readiness overrides and shared empty selectors', () => {
  const base = { ...template, defaults: { ...template.defaults, readySelector: '.saved' } };
  const imported = scenarios => buildImportedConfig(base, template, { scenarios }, '/source/backstop.json', '/project/config.json');
  const mixed = imported([
    { url: 'https://example.test/one', readySelector: '.ready' },
    { url: 'https://example.test/two', readySelector: '' }
  ]);
  assert.equal(mixed.defaults.readySelector, '.saved');
  assert.equal(mixed.scenarios.find(s => s.url === '/two').readySelector, '');
  const disabled = imported([
    { url: 'https://example.test/one', readySelector: '' },
    { url: 'https://example.test/two', readySelector: '' }
  ]);
  assert.equal(disabled.defaults.readySelector, '');
  assert.equal(imported([{ url: 'https://example.test/one' }]).defaults.readySelector, '.saved');
});
