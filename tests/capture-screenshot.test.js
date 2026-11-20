const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const captureScreenshot = require('../scripts/capture-screenshot');
const { buildBrowserLaunchOptions } = require('../scripts/run');

test('primes the selected capture area without saving the incomplete first image', async () => {
  for (const captureOptions of [{ fullPage: true }, { fullPage: false, captureBeyondViewport: true, clip: { x: 0, y: 500, width: 300, height: 200 } }]) {
    const calls = [];
    const page = {
      evaluate: async () => calls.push('settled'),
      screenshot: async options => { calls.push(options); return options.path ? 'final' : 'incomplete'; }
    };
    const options = { path: '/output.png', ...captureOptions };
    assert.equal(await captureScreenshot(page, options), 'final');
    // The priming pass paints the same area but encodes a cheap, unsaved JPEG.
    assert.deepEqual(calls, ['settled', { ...captureOptions, type: 'jpeg', quality: 1 }, 'settled',
      { optimizeForSpeed: true, ...options }]);
    assert.equal(options.path, '/output.png');
  }
});

test('viewport-only screenshots need no extra capture', async () => {
  let captures = 0;
  await captureScreenshot({ evaluate: async () => {}, screenshot: async () => captures++ }, { fullPage: false });
  assert.equal(captures, 1);
});

test('rendering pass preserves viewport height, fixed elements, and clip geometry', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-paint-'));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const page = await browser.newPage();
  const viewport = { width: 360, height: 200, deviceScaleFactor: 1 };
  await page.setViewport(viewport);
  await page.setContent('<style>body{margin:0}header{position:fixed;top:0;height:20px;background:red;width:100%}main{height:100vh}footer{height:800px;background:#0f0f0f}</style><header>Fixed header</header><main></main><footer>Footer</footer>');
  for (const [name, options, width, height] of [
    ['full', { fullPage: true }, 360, 1000],
    ['clip', { fullPage: false, captureBeyondViewport: true, clip: { x: 0, y: 500, width: 300, height: 250 } }, 300, 250]
  ]) {
    const output = path.join(directory, `${name}.png`);
    await captureScreenshot(page, { ...options, path: output });
    const png = await fs.readFile(output);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.deepEqual(page.viewport(), viewport);
    assert.deepEqual(await page.evaluate(() => ({ height: innerHeight, mainHeight: document.querySelector('main').getBoundingClientRect().height, headerTop: document.querySelector('header').getBoundingClientRect().top })), { height: 200, mainHeight: 200, headerTop: 0 });
    // Repeat captures are byte-identical, so the comparison can skip
    // unchanged screenshots; fast encoding keeps the default PNG's pixels.
    const repeat = Buffer.from(await page.screenshot({ ...options, optimizeForSpeed: true }));
    assert.deepEqual(png, repeat);
    assert.equal(await decodedPixelsMatch(browser, png, Buffer.from(await page.screenshot(options))), true);
  }
});

async function decodedPixelsMatch(browser, first, second) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async sources => {
      const pixels = await Promise.all(sources.map(async source => {
        const bitmap = await createImageBitmap(await (await fetch(source)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      }));
      return pixels[0].length === pixels[1].length && pixels[0].every((value, index) => value === pixels[1][index]);
    }, [first, second].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  } finally {
    await page.close();
  }
}
