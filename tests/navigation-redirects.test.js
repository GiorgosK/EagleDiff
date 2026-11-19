const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const fixture = require('./helpers/cli-fixture');
const { captureScreenshots, buildBrowserLaunchOptions, getScreenshotFileName } = require('../scripts/run');
const { inspectInitialDocument } = require('../scripts/navigation');

async function setup(t) {
  const f = await fixture(t);
  f.pages['/one'] = '<style>body{margin:0;background:red}</style><main>Redirect source</main>';
  f.pages['/final'] = '<style>body{margin:0;background:lime}</style><main>Destination</main>';
  f.config.scenarios = [{ url: '/one' }];
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const output = path.join(f.directory, 'captures');
  await fs.mkdir(output);
  const file = path.join(output, getScreenshotFileName(f.config.scenarios[0], f.config.viewports[0]));
  const capture = options => captureScreenshots(browser, f.config, {
    scenarios: f.config.scenarios, viewports: f.config.viewports
  }, output, f.baseURL, false, 'reference', options);
  const pixels = async () => {
    const page = await browser.newPage();
    try {
      return await page.evaluate(async source => {
        const image = new Image(); image.src = source; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return [5, 50].map(y => [...ctx.getImageData(50, y, 1, 1).data]);
      }, 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64'));
    } finally { await page.close(); }
  };
  return { ...f, browser, file, capture, pixels };
}

const preparation = "await page.evaluate(() => { document.body.style.borderTop = '10px solid blue'; });";

test('an initial inspection interrupted by navigation resumes on the destination before preparation', async t => {
  const f = await setup(t);
  f.config.core.temporaryErrorRetries = 0;
  const hook = path.join(f.directory, 'prepare.js');
  await fs.writeFile(hook, `module.exports = async page => { ${preparation} };`);
  f.config.onReadyScript = [hook];
  const createContext = f.browser.createBrowserContext.bind(f.browser);
  f.browser.createBrowserContext = async () => {
    const context = await createContext();
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await newPage();
      const evaluate = page.evaluate.bind(page);
      let interrupted = false;
      page.evaluate = async (...args) => {
        if (!interrupted) {
          interrupted = true;
          return evaluate(async () => {
            location.replace('/final');
            await new Promise(() => {});
          });
        }
        return evaluate(...args);
      };
      return page;
    };
    return context;
  };
  await f.capture();
  assert.equal(f.requests.filter(url => url === '/one').length, 1, 'Initial recovery must not require a fresh capture');
  assert.deepEqual(await f.pixels(), [[0, 0, 255, 255], [0, 255, 0, 255]], 'Save only the destination after its preparation');
  assert.equal(f.browser.browserContexts().length, 1);

  const saved = await fs.readFile(f.file);
  f.pages['/final'] = { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: '<main>Verification</main>' };
  await assert.rejects(f.capture(), /Cloudflare security challenge detected/);
  assert.deepEqual(await fs.readFile(f.file), saved);
  assert.equal(f.browser.browserContexts().length, 1);
});

test('late navigation uses bounded fresh captures, reruns preparation, and preserves earlier images on failure', async t => {
  const f = await setup(t);
  f.config.core.temporaryErrorRetries = 1;
  const hook = path.join(f.directory, 'late-navigation.js');
  const counter = path.join(f.directory, 'attempts');
  await fs.writeFile(hook, `module.exports = async page => {
    const fs = require('node:fs');
    const counter = ${JSON.stringify(counter)};
    const attempts = fs.existsSync(counter) ? Number(fs.readFileSync(counter)) : 0;
    fs.writeFileSync(counter, String(attempts + 1));
    if (!attempts || fs.existsSync(counter + '-always')) {
      await page.evaluate(async () => { location.replace('/final'); await new Promise(() => {}); });
    } else {
      await page.goto(new URL('/final', page.url()).href, { waitUntil: 'load' });
      ${preparation}
    }
  };`);
  f.config.onReadyScript = [hook];
  const retries = [];
  await f.capture({ retryReporter: event => retries.push(event) });
  assert.equal(retries.length, 1);
  assert.equal(f.requests.filter(url => url === '/one').length, 2);
  assert.deepEqual(await f.pixels(), [[0, 0, 255, 255], [0, 255, 0, 255]]);
  const saved = await fs.readFile(f.file);
  await fs.writeFile(counter + '-always', 'yes');
  for (const limit of [0, 2]) {
    f.config.core.temporaryErrorRetries = limit;
    await fs.rm(counter);
    retries.length = 0;
    await assert.rejects(f.capture({ retryReporter: event => retries.push(event) }), /Execution context was destroyed/);
    assert.equal(Number(await fs.readFile(counter)), limit + 1);
    assert.equal(retries.length, limit);
    assert.deepEqual(await fs.readFile(f.file), saved);
    assert.equal(f.browser.browserContexts().length, 1);
  }
});

test('initial inspection limits context recovery and propagates other errors', async () => {
  const page = { isClosed: () => false, browser: () => ({ connected: true }),
    waitForFunction: async () => ({ dispose: async () => {} }) };
  let attempts = 0;
  await assert.rejects(inspectInitialDocument(page, async () => {
    attempts++;
    throw new Error('Execution context was destroyed, most likely because of a navigation.');
  }), /Execution context was destroyed/);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(inspectInitialDocument(page, async () => {
    attempts++;
    throw new Error('Unexpected inspection error');
  }), /Unexpected inspection error/);
  assert.equal(attempts, 1);
});
