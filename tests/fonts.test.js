const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const waitForFonts = require('../scripts/hooks/wait-for-fonts');
const { buildBrowserLaunchOptions, captureScreenshots } = require('../scripts/run');

test('font readiness rejects failed, unresolved, and undeclared web fonts', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/pending.ttf') return;
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  const content = source => `<style>@font-face{font-family:Fixture;src:url('${base}/${source}');font-display:swap}body{font-family:Fixture,serif}</style>Font readiness`;
  await page.setContent(content('missing.ttf'), { waitUntil: 'domcontentloaded' });
  // ready resolves even though the requested web font failed and text uses fallback.
  assert.deepEqual(await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map(face => face.status);
  }), ['error']);
  await assert.rejects(waitForFonts(page), error =>
    error.code === 'EAGLEDIFF_FONT_LOAD' && /Fixture/.test(error.message));
  await page.setContent(content('pending.ttf'), { waitUntil: 'domcontentloaded' });
  await assert.rejects(waitForFonts(page, { scenario: { fontTimeout: 100 } }), error =>
    error.code === 'EAGLEDIFF_FONT_TIMEOUT' && /100ms/.test(error.message));
  await page.goto('about:blank');
  await page.setContent('<p>Native font only</p>');
  await assert.rejects(waitForFonts(page, { scenario: { requiredFonts: ['400 16px Missing'] } }),
    /Required web font is not declared: 400 16px Missing/);
  await assert.rejects(waitForFonts(page, { scenario: { requiredFonts: ['not a font specification'] } }),
    error => error.code === undefined && /Cannot load required font/.test(error.message));
  await waitForFonts(page, { scenario: { requiredFonts: [] }, config: { defaults: { requiredFonts: ['400 16px Missing'] } } });
  await assert.rejects(waitForFonts(page, { scenario: { fontTimeout: 0 } }), /fontTimeout/);
});

test('captures retry failed font downloads and recheck fonts added by later hooks', async t => {
  // Use a locally installed font rather than depending on a network font service.
  let font;
  for (const candidate of ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']) {
    try { font = await fs.readFile(candidate); break; } catch {}
  }
  if (!font) return t.skip('No local test font available');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-fonts-'));
  let fontRequests = 0;
  let lateRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.ttf') {
      fontRequests++;
      if (fontRequests === 1) { res.writeHead(503); res.end(); return; }
      setTimeout(() => { res.setHeader('Content-Type', 'font/ttf'); res.end(font); }, 200);
      return;
    }
    if (req.url === '/missing.ttf') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/late') { lateRequests++; res.end('<p>Initially native text</p>'); return; }
    res.end('<style>@font-face{font-family:Fixture;src:url(/fixture.ttf);font-display:swap}body{font-family:Fixture,serif}</style>Ready');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = {
    core: { temporaryErrorRetries: 1 },
    defaults: { waitUntil: 'domcontentloaded', fullPage: false, fontTimeout: 1000, requiredFonts: ['400 16px Fixture'] },
    onReadyScript: ['hooks/wait-for-fonts'],
    viewports: [{ label: 'phone', width: 320, height: 480 }]
  };
  const capture = scenario => captureScreenshots(browser, config,
    { scenarios: [scenario], viewports: config.viewports }, directory,
    `http://127.0.0.1:${server.address().port}`, false, 'reference');
  await capture({ url: '/' });
  assert.equal(fontRequests, 2, 'a failed font download must retry instead of capturing fallback text');
  assert.equal((await fs.readdir(directory)).length, 1);
  const lateHook = path.join(directory, 'late-font.js');
  await fs.writeFile(lateHook, `module.exports = async page => {
    await page.addStyleTag({ content: '@font-face{font-family:Late;src:url(/missing.ttf);font-display:swap}body{font-family:Late,serif}' });
  };`);
  await assert.rejects(capture({ url: '/late', requiredFonts: [], onReadyScript: [lateHook] }),
    /Web fonts failed to load: Late/);
  assert.equal(lateRequests, 2);
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.png')).length, 1,
    'late failed fonts must not produce a screenshot');
});
