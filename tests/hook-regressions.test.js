const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const http = require('node:http');
const profile = { defaults: { scrollStepDelayMs: 20, scrollSettleDelayMs: 50, scrollTimeout: 5000, lazyImageTimeout: 2000, normalizeResponsiveImageSelectors: ['img', 'picture source'], normalizeImageDecodingSelectors: ['img'] } };
const scroll = require('../scripts/hooks/scroll-to-bottom');
const styles = require('../scripts/hooks/apply-css-overrides');
const images = require('../scripts/hooks/load-lazy-images');
const responsive = require('../scripts/hooks/normalize-responsive-images');
const decoding = require('../scripts/hooks/normalize-image-decoding');
const stable = require('../scripts/hooks/wait-for-stable-content');
const network = require('../scripts/hooks/wait-for-network-idle');

test('e86b943: scrolling loads every deferred section and returns to the top', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 360, height: 740 });
  await page.setContent(`<style>body{margin:0}.chapter{height:800px}</style>
    <main>${'<section class="chapter">Section</section>'.repeat(7)}</main>
    <script>addEventListener('scroll',()=>{
      if(document.querySelectorAll('.chapter').length < 10 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1){
        const chapter=document.createElement('section'); chapter.className='chapter'; chapter.textContent='Deferred section'; document.querySelector('main').append(chapter);
      }
    });</script>`);
  assert.equal(await page.$$eval('.chapter', nodes => nodes.length), 7);
  await scroll(page, { mode: 'ready', scenario: {}, config: profile });
  assert.equal(await page.$$eval('.chapter', nodes => nodes.length), 10);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert(await page.evaluate(() => document.documentElement.scrollHeight > 7000));
});

test('3270078: early CSS prevents a persistent widget decision that late CSS cannot undo', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.pages['/init'] = `<style>.summary{outline:4px solid red}</style><main class="summary">Summary</main>
    <script>if(getComputedStyle(document.querySelector('.summary')).outlineStyle !== 'none'){
      const note=document.createElement('p');note.className='boot-layout';note.textContent='Initial layout decision';document.body.append(note);
    }</script>`;
  const config = { defaults: { cssOverrides: '.summary { outline:none!important; }' } };
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const late = await browser.newPage();
  await late.goto(fixture.baseURL + '/init');
  assert(await late.$('.boot-layout'));
  await styles(late, { mode: 'ready', scenario: {}, config });
  assert(await late.$('.boot-layout'), 'late CSS cannot undo the page initialization decision');
  const early = await browser.newPage();
  await styles(early, { mode: 'before', scenario: {}, config });
  await early.goto(fixture.baseURL + '/init');
  assert.equal(await early.$('.boot-layout'), null);
});

test('d02ce02: lazy picture candidates survive normalization and JPEGs have decoded PNG replacements', async t => {
  const host = await imageFixture(t);
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
  host.jpeg = Buffer.from(await page.evaluate(() => {
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    canvas.getContext('2d').fillRect(0,0,640,360);return canvas.toDataURL('image/jpeg').split(',')[1];
  }), 'base64');
  await page.goto(host.url + '/picture');
  const context = { mode: 'ready', scenario: {}, config: profile };
  await images(page, context);
  const loaded = await page.$eval('img', image => image.currentSrc);
  assert(loaded.endsWith('/alternate.svg'));
  await responsive(page, context);
  assert.deepEqual(await page.$eval('img', image => [image.currentSrc, image.naturalWidth, image.naturalHeight]), [loaded, 640, 360]);
  assert.equal(await page.$eval('picture source', source => source.hasAttribute('srcset')), false);
  await page.goto(host.url + '/jpeg');
  await images(page, context); await decoding(page, context);
  assert.match(await page.$eval('img', image => image.currentSrc), /^blob:/);
  assert.deepEqual(await page.$eval('img', image => [image.naturalWidth, image.naturalHeight]), [640, 360]);
});

test('d18a0c1: real browser shutdown propagates through an active network-idle wait', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  const rejected = assert.rejects(network(page, { scenario: {}, config: { defaults: { networkIdleTime: 5000, networkIdleTimeout: 10000 } } }), /closed|detached|Connection/i);
  await browser.close(); await rejected;
});

test('legacy stable-content settings wait for a triggered widget when nested settings are absent', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<span class="trigger"></span><script>setTimeout(()=>{const p=document.createElement("p");p.className="widget";p.textContent="Final widget";document.body.append(p)},100)</script>');
  await stable(page, { scenario: {}, config: { defaults: { waitForTriggerSelectors: ['.trigger'], waitForSelectors: ['.widget'], waitForTimeout: 2000, waitForSettleDelayMs: 50 } } });
  assert.equal(await page.$eval('.widget', node => node.textContent), 'Final widget');
});

test('media pause hook freezes a playing local audio element', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage();
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  await page.setContent(`<audio loop src="data:audio/wav;base64,${wav.toString('base64')}"></audio><button>Play</button>`);
  await page.$eval('button', button => button.addEventListener('click', () => document.querySelector('audio').play()));
  await page.click('button'); await page.waitForFunction(() => !document.querySelector('audio').paused);
  await require('../scripts/hooks/pause-media')(page);
  assert.equal(await page.$eval('audio', audio => audio.paused), true);
});

test('injected paragraph options create a deliberate CLI difference only when requested', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.pages['/one'] = '<style>body{margin:0}main{width:100px}p{margin:0}</style><main><p>Guide</p></main>';
  fixture.config.defaults.fullPage = true;
  fixture.config.scenarios = [{ url: '/one', addParagraph: true, addParagraphTarget: 'main',
    addParagraphText: 'A deliberate added product note.', addParagraphSelector: '#review-note' }];
  await fixture.save(); await fixture.run(['reference']); await fixture.run(['test']);
  await fixture.run(['test', '--addpara'], 1);
  const report = JSON.parse(await fs.readFile(path.join(fixture.directory, '.reg/run/out.json')));
  assert.equal(report.failedItems.length, 1);
  const image = await fs.readFile(path.join(fixture.directory, '.reg/actual', report.failedItems[0]));
  assert(image.readUInt32BE(20) > 100, 'injected note must increase the saved full-page PNG height');
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent('<main><p>Guide</p></main>');
  await require('../scripts/hooks/add-paragraph')(page, { scenario: fixture.config.scenarios[0] });
  assert.deepEqual(await page.$eval('#review-note', node => [node.parentElement.tagName, node.textContent]),
    ['MAIN', 'A deliberate added product note.']);
});

test('root ready/status fallbacks work when shared nested settings are absent', async t => {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent('<main class="ready">Guide ready</main>');
  await require('../scripts/hooks/wait-for-element')(page, { scenario: {}, config: { readySelector: '.ready', readyTimeout: 1000 } });
  assert.equal(await page.$eval('.ready', node => node.textContent), 'Guide ready');
  await assert.rejects(require('../scripts/hooks/fail-on-response-status')(page, { scenario: {}, config: { failOnResponseStatusCodes: [503] }, navigationResponseStatus: 503 }), /Blocked response status 503/);
});

test('730ca29: a slow second background layer is decoded and a stalled layer still fails in warning mode', async t => {
  const host = await imageFixture(t);
  const browser = await puppeteer.launch(buildBrowserLaunchOptions()); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<div style="height:200px;background-image:url('${host.url}/photo.svg'),url('${host.url}/slow.svg')">Feature panel</div>`, { waitUntil: 'domcontentloaded' });
  await require('../scripts/hooks/wait-for-background-images')(page, { scenario: {}, config: { defaults: { lazyImageTimeout: 2000 } } });
  assert(host.finished.includes('/slow.svg'), 'second layer must finish before readiness resolves');
  await page.$eval('div', (node, source) => { node.style.backgroundImage = `url("${source}")`; }, host.url + '/stall.svg');
  await assert.rejects(require('../scripts/hooks/wait-for-background-images')(page, { scenario: {}, config: { defaults: { lazyImageTimeout: 150, imageFailurePolicy: 'warn' } } }), error => error.code === 'EAGLEDIFF_IMAGE_TIMEOUT');
});

async function imageFixture(t) {
  const state = { finished: [], jpeg: null }, timers = new Set();
  const server = http.createServer((request, response) => {
    response.once('finish', () => state.finished.push(request.url));
    if (request.url === '/stall.svg') return;
    if (request.url === '/picture' || request.url === '/jpeg') {
      response.setHeader('Content-Type','text/html');
      response.end(request.url === '/picture' ? '<picture><source media="(min-width:800px)" data-srcset="/alternate.svg"><img src="/photo.svg" width="640" height="360"></picture>' : '<img src="/image.jpg" width="640" height="360">'); return;
    }
    if (request.url === '/image.jpg') { response.setHeader('Content-Type','image/jpeg');response.end(state.jpeg);return; }
    const send = () => { response.setHeader('Content-Type','image/svg+xml');response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${request.url === '/alternate.svg' ? 'blue' : 'green'}"/></svg>`); };
    if (request.url === '/slow.svg') {
      const timer=setTimeout(()=>{timers.delete(timer);send();},150);timers.add(timer);
      response.once('close',()=>{clearTimeout(timer);timers.delete(timer);});
    } else send();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  state.url='http://127.0.0.1:'+server.address().port;
  return state;
}
