const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const consent = require('../scripts/hooks/handle-cookie-consent');
const dynamic = require('../scripts/hooks/hide-dynamic-elements');
const { resolveOptions, providers } = require('../scripts/cookie-consent');
const template = require('../config-default.json');

async function setup(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  return browser.newPage();
}
const context = (mode, timeout = 300) => ({ mode: 'ready', scenario: { cookieConsent: mode, cookieConsentTimeout: timeout }, config: template });

function webtoolsBanner(accept = 'Accept all cookies', essential = 'Accept only essential cookies') {
  // The wrapper has no box; its fixed child is the visible dialog.
  return `<div id="fixture-banner" class="wt-cck--banner"><div class="wt-cck--container" style="position:fixed;inset:0;background:red">
    <a id="fixture-essential" class="wt-cck--actions-button" href="#refuse">${essential}</a>
    <a id="fixture-accept" class="wt-cck--actions-button" href="#accept">${accept}</a>
  </div></div>`;
}

function banner(provider) {
  const dialogSelector = provider.dialogs[0];
  const buttonSelector = provider.accept[0].split(' ').at(-1);
  const dialog = dialogSelector.startsWith('#') ? dialogSelector.slice(1).split('.')[0] : 'fixture-banner';
  const button = buttonSelector.startsWith('#') ? buttonSelector.slice(1) : 'fixture-accept';
  const dialogClass = dialogSelector.split('.').slice(1).join(' ');
  const buttonClass = buttonSelector.startsWith('.') ? buttonSelector.slice(1) : '';
  const markup = provider.name === 'European Commission Webtools' ? webtoolsBanner() :
    `<div id="${dialog}" class="${dialogClass}" style="position:fixed;inset:0;background:red"><button id="${button}" class="${buttonClass}">Allow all</button></div>`;
  return `${markup}
    <script>document.getElementById('${button}').onclick=()=>{
      window.accepted=(window.accepted||0)+1;
      document.cookie='fixture-consent=all; path=/';
      document.getElementById('${dialog}').remove();
      const image = new Image(); image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="lime"/></svg>');
      image.id='unlocked';document.body.append(image);
    };</script>`;
}

test('hide suppresses known banners and late overlays without clicking or changing cookies', async t => {
  const page = await setup(t);
  await consent(page, { ...context('hide'), mode: 'before' });
  await page.goto('data:text/html,' + encodeURIComponent('<main>Page</main>' + banner(providers[0])));
  assert.equal(await page.$eval('#onetrust-banner-sdk', node => getComputedStyle(node).display), 'none');
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div id="didomi-host">Didomi</div><div class="onetrust-pc-dark-filter">Overlay</div>'));
  assert(await page.$$eval('#didomi-host,.onetrust-pc-dark-filter', nodes => nodes.every(node => getComputedStyle(node).display === 'none')));
  assert.equal(await page.evaluate(() => window.accepted || 0), 0);
  assert.notEqual(await page.$eval('main', node => getComputedStyle(node).display), 'none');
});

test('cookie-banner defaults belong to the consent hook while general dynamic hiding still applies', async t => {
  const page = await setup(t);
  await page.setContent(banner(providers[1]) + '<div id="toolbar-administration">Toolbar</div>');
  await dynamic(page, { scenario: {}, config: template });
  assert.equal(await page.$eval('#toolbar-administration', node => getComputedStyle(node).display), 'none');
  assert.notEqual(await page.$eval('#CybotCookiebotDialog', node => getComputedStyle(node).display), 'none');
  await consent(page, context('hide'));
  assert.equal(await page.$eval('#CybotCookiebotDialog', node => getComputedStyle(node).display), 'none');
});

test('accept clicks each known provider and preserves real consent effects', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  const page = await setup(t);
  for (const provider of providers) {
    fixture.pages['/one'] = '<button id="unrelated">Accept order</button>' + banner(provider);
    await page.goto(fixture.baseURL + '/one');
    await dynamic(page, context('accept'));
    await consent(page, context('accept'));
    assert.equal(await page.evaluate(() => window.accepted), 1, provider.name);
    assert.equal(await page.$eval('#unrelated', button => button.isConnected), true);
    assert((await page.cookies()).some(cookie => cookie.name === 'fixture-consent' && cookie.value === 'all'));
    await page.$eval('#unlocked', image => image.decode());
    assert.equal(await page.$eval('#unlocked', image => image.naturalWidth), 10);
  }
});

test('leave preserves unrelated explicit hide rules and empty-selector overrides', async t => {
  const page = await setup(t);
  await page.setContent(banner(providers[1]) + '<aside id="custom">Custom</aside>');
  const settings = context('leave');
  settings.config = { defaults: { ...template.defaults, hideDynamicSelectors: [...template.defaults.hideDynamicSelectors, '#custom'] } };
  await dynamic(page, settings);
  await consent(page, settings);
  assert.notEqual(await page.$eval('#CybotCookiebotDialog', node => getComputedStyle(node).display), 'none');
  assert.equal(await page.$eval('#custom', node => getComputedStyle(node).display), 'none');
  assert.equal(await page.evaluate(() => window.accepted || 0), 0);
  assert.equal(resolveOptions(template, { hideDynamicSelectors: [] }).mode, 'leave');
  assert.equal(resolveOptions(template, { hideDynamicSelectors: [], cookieConsent: 'hide' }).mode, 'hide');
});

test('accept waits for late buttons, skips absent banners and unrelated accept buttons, and bounds unsupported dialogs', async t => {
  const page = await setup(t);
  await page.setContent('<div id="onetrust-banner-sdk"><p>Loading consent</p></div><button id="unrelated">Accept all</button>');
  await page.evaluate(() => {
    document.querySelector('#unrelated').onclick = () => { window.unrelatedClicked = true; };
    setTimeout(() => {
      const button = document.createElement('button');button.id='onetrust-accept-btn-handler';button.textContent='Allow all';
      button.onclick=()=>{window.accepted=true;document.querySelector('#onetrust-banner-sdk').remove();};
      document.querySelector('#onetrust-banner-sdk').append(button);
    }, 100);
  });
  await consent(page, context('accept', 600));
  assert.equal(await page.evaluate(() => window.accepted), true);
  await consent(page, context('accept', 100));
  assert.equal(await page.evaluate(() => window.unrelatedClicked || false), false);
  await page.setContent('<div id="onetrust-banner-sdk">Unsupported customized banner</div>');
  await assert.rejects(consent(page, context('accept', 100)), error => error.code === 'EAGLEDIFF_COOKIE_CONSENT_TIMEOUT' && /OneTrust/.test(error.message));
  await page.setContent('<div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler">Allow all</button></div>');
  await assert.rejects(consent(page, context('accept', 100)), /banner stayed open/);
});

test('consent defaults, explicit overrides, import and retry budgets retain their meanings', () => {
  const { updateConfig } = require('../scripts/config-update');
  const { buildImportedConfig } = require('../scripts/import');
  const { withRetryTimeouts } = require('../scripts/retry-timeouts');
  assert.equal(updateConfig({}, template).defaults.cookieConsent, 'hide');
  assert.equal(updateConfig({ defaults: { hideDynamicSelectors: [] } }, template).defaults.cookieConsent, 'leave');
  assert.equal(updateConfig({ defaults: { hideDynamicSelectors: [], cookieConsent: 'accept' } }, template).defaults.cookieConsent, 'accept');
  const updated = updateConfig({ defaults: { cookieConsent: 'leave', cookieConsentTimeout: 123 },
    scenarios: [{ url: '/', cookieConsent: 'accept' }] }, template);
  assert.equal(updated.defaults.cookieConsent, 'leave');
  assert.equal(updated.defaults.cookieConsentTimeout, 123);
  assert.equal(resolveOptions(updated, updated.scenarios[0]).mode, 'accept');
  const imported = buildImportedConfig(template, template, { scenarios: [
    { url: 'https://example.test/one', cookieConsent: 'accept', cookieConsentTimeout: 123 },
    { url: 'https://example.test/two', cookieConsent: 'leave', cookieConsentTimeout: 456 }
  ] }, '/source/backstop.json', '/project/config.json');
  assert.equal(imported.scenarios[0].cookieConsent, 'accept');
  assert.equal(imported.scenarios[1].cookieConsent, 'leave');
  assert.equal(withRetryTimeouts({ core: { temporaryErrorRetryTimeoutMultiplier: 2 } }, { cookieConsentTimeout: 123 }, 1).scenario.cookieConsentTimeout, 246);
  for (const cookieConsent of [false, '', 'unknown']) assert.throws(() => resolveOptions({}, { cookieConsent }), /cookieConsent/);
  for (const cookieConsentTimeout of [0, -1, Infinity, '100']) assert.throws(() => resolveOptions({}, { cookieConsentTimeout }), /positive number/);
});

test('cookie-consent component supports hide, accept-all and leave with class-based closing', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.pages['/one'] = `<style>body{background:blue}
    #cookie-consent{position:fixed;inset:0;background:red}
    #cookie-consent:not(.cookie-consent__wrapper--visible){visibility:hidden}</style>
    <div id="cookie-consent" class="cookie-consent__wrapper">
      <div class="cookie-selection__btn" role="button">Accept selection</div>
      <div class="cookie-all__btn" role="button">Accept all</div>
    </div><button id="unrelated">Accept all</button><script>
      setTimeout(()=>document.querySelector('#cookie-consent').classList.add('cookie-consent__wrapper--visible'),50);
      document.querySelector('.cookie-selection__btn').onclick=()=>window.selectionClicked=true;
      document.querySelector('#unrelated').onclick=()=>window.unrelatedClicked=true;
      document.querySelector('.cookie-all__btn').onclick=()=>{
        window.allClicked=(window.allClicked||0)+1;
        document.cookie='fixture-consent=all; path=/';
        document.querySelector('#cookie-consent').classList.remove('cookie-consent__wrapper--visible');
      };
    </script>`;
  for (const mode of ['hide', 'accept', 'leave']) {
    const page = await setup(t);
    await consent(page, { ...context(mode, 1000), mode: 'before' });
    await page.goto(f.baseURL + '/one');
    await page.waitForFunction(() => document.querySelector('#cookie-consent').classList.contains('cookie-consent__wrapper--visible'));
    await consent(page, context(mode, 1000));
    const state = await page.evaluate(() => ({
      accepted: window.allClicked || 0, selection: !!window.selectionClicked, unrelated: !!window.unrelatedClicked,
      display: getComputedStyle(document.querySelector('#cookie-consent')).display,
      open: document.querySelector('#cookie-consent').classList.contains('cookie-consent__wrapper--visible')
    }));
    assert.equal(state.accepted, mode === 'accept' ? 1 : 0);
    assert.equal(state.selection, false);
    assert.equal(state.unrelated, false);
    assert.equal(state.open, mode !== 'accept');
    assert.equal(state.display === 'none', mode === 'hide');
    assert.equal((await page.cookies()).some(cookie => cookie.name === 'fixture-consent' && cookie.value === 'all'), mode === 'accept');
  }
});

test('invalid consent settings are rejected before browser requests or output mutations', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.config.defaults.cookieConsent = 'invalid';
  await fixture.save();
  assert.match((await fixture.run(['reference'], 1)).stderr, /cookieConsent/);
  assert.deepEqual(fixture.requests, []);
  await assert.rejects(fs.access(path.join(fixture.directory, '.reg')), { code: 'ENOENT' });
});

test('Automattic/A8C accept-all links obey hide, accept and leave without clicking customization', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  fixture.pages['/one'] = '<form class="a8c-cookie-banner"><a href="#" class="a8c-cookie-banner__customize-button">Customize</a>' +
    '<a href="#" class="a8c-cookie-banner__accept-all-button">Accept all</a></form><script>' +
    'document.querySelector(".a8c-cookie-banner__customize-button").onclick=e=>{e.preventDefault();window.customized=true};' +
    'document.querySelector(".a8c-cookie-banner__accept-all-button").onclick=e=>{e.preventDefault();document.cookie="fixture-accepted=all; path=/";document.querySelector("form").remove()};</script>';
  for (const mode of ['hide', 'accept', 'leave']) {
    const page = await setup(t);
    await consent(page, { ...context(mode), mode: 'before' });
    await page.goto(fixture.baseURL + '/one');
    await consent(page, context(mode));
    const accepted = (await page.cookies()).some(cookie => cookie.name === 'fixture-accepted');
    assert.equal(accepted, mode === 'accept');
    assert.equal(await page.evaluate(() => window.customized || false), false);
    if (mode === 'accept') assert.equal(await page.$('.a8c-cookie-banner'), null);
    else assert.equal(await page.$eval('.a8c-cookie-banner', banner => getComputedStyle(banner).display === 'none'), mode === 'hide');
  }
});

test('capture modes produce distinct PNGs and a failed acceptance retries without replacing the baseline', async t => {
  const fixture = await require('./helpers/cli-fixture')(t);
  const page = await setup(t);
  fixture.pages['/one'] = '<style>body{margin:0;background:blue}</style>' + banner(providers[0]).replace(
    'window.accepted=(window.accepted||0)+1;',
    "window.accepted=(window.accepted||0)+1;document.body.style.background='lime';");
  fixture.config.scenarios = [{ url: '/one' }];
  fixture.config.defaults.hideDynamicSelectors = template.defaults.hideDynamicSelectors;
  fixture.config.defaults.cookieConsentTimeout = 250;
  fixture.config.onBeforeScript = ['hooks/handle-cookie-consent', 'hooks/hide-dynamic-elements'];
  fixture.config.onReadyScript = ['hooks/handle-cookie-consent', 'hooks/hide-dynamic-elements', 'hooks/load-lazy-images'];
  for (const [mode, expected] of [['hide', [0, 0, 255, 255]], ['accept', [0, 255, 0, 255]], ['leave', [255, 0, 0, 255]]]) {
    fixture.config.defaults.cookieConsent = mode;
    await fixture.save();
    await fixture.run(['reference']);
    const png = await fs.readFile(path.join(fixture.directory, '.reg/reference', (await fixture.files())[0]));
    const pixel = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(90, 90, 1, 1).data];
    }, 'data:image/png;base64,' + png.toString('base64'));
    assert.deepEqual(pixel, expected, mode);
  }
  const baseline = path.join(fixture.directory, '.reg/reference', (await fixture.files())[0]);
  const before = await fs.readFile(baseline);
  fixture.config.defaults.cookieConsent = 'accept';
  fixture.config.core.temporaryErrorRetries = 1;
  fixture.pages['/one'] = '<div id="onetrust-banner-sdk">No supported accept-all control</div>';
  await fixture.save();
  const requestsBefore = fixture.requests.filter(url => url === '/one').length;
  assert.match((await fixture.run(['reference'], 1)).stderr, /Could not accept cookie consent/);
  assert.equal(fixture.requests.filter(url => url === '/one').length - requestsBefore, 2);
  assert.deepEqual(await fs.readFile(baseline), before);
});

test('Webtools banners support hide, accept-all and leave across languages without affecting separate popups', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  for (const labels of [undefined, ['Αποδοχή όλων των cookies', 'Μόνο απαραίτητα cookies']]) {
    const markup = labels ? webtoolsBanner(...labels) : webtoolsBanner();
    f.pages['/one'] = `<main>Page content</main>
      <a id="unrelated" class="wt-cck--actions-button" href="#accept">Accept something else</a>
      <aside id="separate-popup">Feedback survey</aside><script>
        setTimeout(()=>document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(markup)}), 30);
        document.addEventListener('click', event => {
          event.preventDefault();
          if(event.target.id==='unrelated') window.unrelatedClicked=true;
          if(event.target.id==='fixture-essential') window.essentialClicked=true;
          if(event.target.id==='fixture-accept') {
            window.accepted=(window.accepted||0)+1;
            document.cookie='fixture-consent=all; path=/';
            document.querySelector('.wt-cck--banner').remove();
          }
        });
      </script>`;
    for (const mode of ['hide', 'accept', 'leave']) {
      const page = await setup(t);
      await consent(page, { ...context(mode, 1000), mode: 'before' });
      await page.goto(f.baseURL + '/one');
      await page.waitForSelector('.wt-cck--banner');
      assert.equal(await page.$eval('.wt-cck--banner', element => element.getBoundingClientRect().height), 0);
      await consent(page, context(mode, 1000));
      const state = await page.evaluate(() => ({
        accepted: window.accepted || 0, essential: !!window.essentialClicked,
        unrelated: !!window.unrelatedClicked, present: !!document.querySelector('.wt-cck--banner'),
        visible: !!document.querySelector('#fixture-accept')?.getBoundingClientRect().height,
        popupVisible: !!document.querySelector('#separate-popup').getBoundingClientRect().height
      }));
      assert.equal(state.accepted, mode === 'accept' ? 1 : 0);
      assert.equal(state.present, mode !== 'accept');
      assert.equal(state.visible, mode === 'leave');
      assert.equal(state.essential, false);
      assert.equal(state.unrelated, false);
      assert.equal(state.popupVisible, true);
      assert.equal((await page.cookies()).some(cookie => cookie.name === 'fixture-consent' && cookie.value === 'all'), mode === 'accept');
    }
  }
});

test('Webtools acceptance stops when only the essential-cookies option is available', async t => {
  const page = await setup(t);
  await page.setContent(webtoolsBanner());
  await page.$eval('#fixture-accept', element => element.remove());
  await page.$eval('#fixture-essential', element => { element.onclick = () => { window.essentialClicked = true; }; });
  await assert.rejects(consent(page, context('accept', 100)), error =>
    error.code === 'EAGLEDIFF_COOKIE_CONSENT_TIMEOUT' && /Webtools/.test(error.message));
  assert.equal(await page.evaluate(() => !!window.essentialClicked), false);
});
