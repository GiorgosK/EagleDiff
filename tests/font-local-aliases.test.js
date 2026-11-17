const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const waitForFonts = require('../scripts/hooks/wait-for-fonts');

const missingLocal = 'Eaglediff Missing Local Fixture 93857';
const alias = family => `@font-face{font-family:${family};src:local("${missingLocal}, url(not-a-download)"),local(MissingLocalFixture93858)}`;

async function fixture(t) {
  let font;
  for (const candidate of ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']) {
    try { font = await fs.readFile(candidate); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const server = http.createServer((request, response) => {
    if (request.url === '/font.ttf') {
      response.setHeader('Content-Type', 'font/ttf'); response.end(font);
    } else if (request.url === '/missing.ttf') {
      response.writeHead(404); response.end();
    } else if (request.url === '/nested.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(`@media all{@supports(display:block){${alias('NestedAlias')}}}`);
    } else { response.setHeader('Content-Type', 'text/html'); response.end('<main>Ready</main>'); }
  });
  const opaque = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/css'); response.end(alias('OpaqueAlias'));
  });
  for (const service of [server, opaque]) await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close();
    for (const service of [server, opaque]) {
      service.closeAllConnections(); await new Promise(resolve => service.close(resolve));
    }
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 200, height: 100 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  return { page, fontAvailable: !!font, opaqueURL: `http://127.0.0.1:${opaque.address().port}/opaque.css` };
}

const failLoad = (page, font) => page.evaluate(font => document.fonts.load(font).catch(() => {}), font);

test('missing local aliases do not block a loaded web font or change its captured rendering', async t => {
  const { page, fontAvailable } = await fixture(t);
  if (!fontAvailable) return t.skip('No local test font available');
  await page.setContent(`<style>@font-face{font-family:Primary;src:url('/font.ttf')}
    body{margin:0;background:white;color:black;font:24px Primary,LocalAlias,sans-serif}</style>
    <style id="alias">${alias('LocalAlias')}</style><main>Font readiness</main>`);
  await failLoad(page, '24px LocalAlias');
  await waitForFonts(page, { scenario: { requiredFonts: ['24px Primary'] } });
  assert.deepEqual(await page.evaluate(() => [...document.fonts].map(face => [face.family, face.status])),
    [['Primary', 'loaded'], ['LocalAlias', 'error']]);
  const before = await page.screenshot();
  await page.$eval('#alias', element => element.remove());
  await waitForFonts(page);
  const after = await page.screenshot();
  assert.deepEqual(before, after, 'The unavailable alias must not alter the loaded primary font rendering');
});

test('explicitly required local aliases remain strict', async t => {
  const { page } = await fixture(t);
  await page.setContent(`<style>${alias('LocalAlias')}
    @font-face{font-family:LocalAlias;src:local("${missingLocal}");font-weight:700;font-style:italic}
    body{font-family:LocalAlias,sans-serif}</style><main>Ready</main>`);
  await failLoad(page, '16px LocalAlias');
  await failLoad(page, 'italic 700 16px LocalAlias');
  await waitForFonts(page);
  await assert.rejects(waitForFonts(page, { scenario: { requiredFonts: ['italic 700 16px LocalAlias'] } }),
    error => error.code === 'EAGLEDIFF_FONT_LOAD' && /Cannot load required font/.test(error.message));
});

test('failed downloads remain errors even with fallback names or mixed local sources', async t => {
  const { page } = await fixture(t);
  for (const src of ['url(/missing.ttf)', `local("${missingLocal}"),url(/missing.ttf)`]) {
    await page.setContent(`<style>@font-face{font-family:"Fixture Fallback";src:${src}}
      body{font-family:"Fixture Fallback",sans-serif}</style><main>Ready</main>`);
    await failLoad(page, '16px "Fixture Fallback"');
    await assert.rejects(waitForFonts(page), error =>
      error.code === 'EAGLEDIFF_FONT_LOAD' && /Fixture Fallback/.test(error.message));
  }
});

test('a matching JS-created failed font cannot inherit a CSS local alias exemption', async t => {
  const { page } = await fixture(t);
  await page.setContent(`<style>${alias('LocalAlias')}body{font-family:LocalAlias,sans-serif}</style><main>Ready</main>`);
  await failLoad(page, '16px LocalAlias');
  await page.evaluate(async () => {
    window.fixtureFont = new FontFace('LocalAlias', 'url(/missing.ttf)');
    document.fonts.add(fixtureFont); await fixtureFont.load().catch(() => {});
  });
  await assert.rejects(waitForFonts(page), /Web fonts failed to load: LocalAlias/);
  await page.evaluate(() => document.fonts.delete(fixtureFont));
  await waitForFonts(page);
});

test('readable imports, conditional rules and adopted sheets support local aliases', async t => {
  const { page } = await fixture(t);
  await page.setContent('<style>@import url(/nested.css);body{font-family:NestedAlias,sans-serif}</style><main>Ready</main>');
  await failLoad(page, '16px NestedAlias');
  assert.equal(await page.evaluate(() => [...document.fonts].find(face => face.family === 'NestedAlias')?.status), 'error');
  await waitForFonts(page);
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('@font-face{font-family:AdoptedAlias;src:local("Missing adopted fixture 93857")}');
    document.adoptedStyleSheets = [sheet];
  });
  await failLoad(page, '16px AdoptedAlias');
  await waitForFonts(page);
});

test('inactive or unreadable stylesheets cannot exempt a failed font', async t => {
  const { page, opaqueURL } = await fixture(t);
  await page.setContent(`<style media="not all">${alias('LocalAlias')}</style><main>Ready</main>`);
  await page.evaluate(async () => {
    const font = new FontFace('LocalAlias', 'url(/missing.ttf)');
    document.fonts.add(font); await font.load().catch(() => {});
  });
  await assert.rejects(waitForFonts(page), /Web fonts failed to load: LocalAlias/);
  await page.setContent(`<link rel="stylesheet" href="${opaqueURL}"><style>body{font-family:OpaqueAlias,sans-serif}</style><main>Ready</main>`);
  await failLoad(page, '16px OpaqueAlias');
  await assert.rejects(waitForFonts(page), /Web fonts failed to load: OpaqueAlias/);
});
