const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const fixture = require('./helpers/cli-fixture');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const captureScreenshot = require('../scripts/capture-screenshot');
const { assertNoChallenge, detectChallengeHeaders, challengeError } = require('../scripts/challenge-detector');

const cloudflare = '<title>Just a moment...</title><script type="application/json" src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script><main>Verifying</main>';
let browser;
before(async () => { browser = await puppeteer.launch(buildBrowserLaunchOptions()); });
after(async () => { await browser?.close(); });

async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  // Vendor URLs identify inert fixture markup; no requests leave this browser.
  await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '' }));
  await page.goto('http://fixture.test/');
  return page;
}

test('only documented challenge response headers identify Cloudflare and AWS WAF', () => {
  assert.equal(detectChallengeHeaders({ 'CF-Mitigated': ' Challenge ' }), 'Cloudflare');
  assert.equal(detectChallengeHeaders({ 'x-amzn-waf-action': 'challenge' }), 'AWS WAF');
  assert.equal(detectChallengeHeaders({ 'x-amzn-waf-action': 'captcha' }), 'AWS WAF');
  for (const headers of [{}, { server: 'cloudflare', 'cf-ray': 'example' },
    { 'x-datadome': 'protected' }, { 'x-amzn-waf-action': 'allow' }, { 'cf-mitigated': 'other' }]) {
    assert.equal(detectChallengeHeaders(headers), null);
  }
  const error = challengeError('Cloudflare', 'https://user:password@example.test/page?token=private#secret');
  assert.match(error.message, /https:\/\/example.test\/page/);
  assert.doesNotMatch(error.message, /password|private|secret|user:/);
});

test('browser checks identify known interstitials even when the server returns HTTP 200', async t => {
  const page = await pageFixture(t);
  const pages = [
    ['Cloudflare', cloudflare],
    ['Cloudflare', '<form id="challenge-form">Verifying</form><script>window._cf_chl_opt = {};</script>'],
    ['DataDome', '<iframe width="400" height="300" src="https://geo.captcha-delivery.com/captcha/"></iframe>'],
    ['HUMAN/PerimeterX', '<div id="px-captcha" style="height:200px">Press and hold</div><script type="application/json" src="https://captcha.px-cdn.net/example/captcha.js"></script>']
  ];
  for (const [provider, html] of pages) {
    await page.setContent(html);
    await assert.rejects(assertNoChallenge(page), error => {
      assert.equal(error.code, 'EAGLEDIFF_CHALLENGE_DETECTED');
      assert(error.message.includes(provider));
      assert.match(error.message, /Capture stopped/);
      return true;
    });
  }
});

test('normal CDN scripts, CAPTCHA widgets, and hidden or offscreen challenge frames are allowed', async t => {
  const page = await pageFixture(t);
  const pages = [
    '<title>Just a moment...</title><main>An article about Cloudflare challenges</main>',
    '<div class="cf-turnstile"></div><iframe src="https://challenges.cloudflare.com/widget"></iframe>',
    '<div class="g-recaptcha"></div><script type="application/json" src="https://www.google.com/recaptcha/api.js"></script>',
    '<script type="application/json" src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><main>Website</main>',
    '<script type="application/json" src="https://example.awswaf.com/challenge.js"></script><main>Website</main>',
    '<script type="application/json" src="https://js.datadome.co/tags.js"></script>',
    '<div style="display:none"><iframe src="https://geo.captcha-delivery.com/captcha/"></iframe></div>',
    '<iframe style="position:absolute;top:20000px" src="https://geo.captcha-delivery.com/captcha/"></iframe>',
    '<iframe src="https://captcha-delivery.com.example.test/captcha/"></iframe>',
    '<div id="px-captcha" style="display:none">Widget</div><script type="application/json" src="https://captcha.px-cdn.net/example/captcha.js"></script>',
    '<div id="px-captcha">Ordinary placeholder</div><script type="application/json" src="https://client.perimeterx.net/example/main.min.js"></script>'
  ];
  for (const html of pages) {
    await page.setContent(html);
    await assertNoChallenge(page);
  }
});

test('reference and test stop without retries, baseline changes, or an approvable partial comparison', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  await f.run(['test']);
  const names = await f.files();
  const readReferences = () => Promise.all(names.map(name => fs.readFile(path.join(f.directory, '.reg/reference', name))));
  const references = await readReferences();
  const historyPath = path.join(f.directory, 'results.json');
  const history = await fs.readFile(historyPath, 'utf8');
  f.config.core.temporaryErrorRetries = 2;
  await f.save();
  const challenges = [
    ['Cloudflare', { 'cf-mitigated': 'challenge' }, 403],
    ['AWS WAF', { 'x-amzn-waf-action': 'captcha' }, 405]
  ];
  for (const [provider, headers, status] of challenges) {
    f.pages['/two'] = { headers, status, body: '<h1>Verification instead of the website</h1>' };
    for (const command of ['reference', 'test']) {
      for (const workers of [1, 2]) {
        f.requests.length = 0;
        const failed = await f.run([command, `--workers=${workers}`], 1);
        assert(failed.stderr.includes(provider));
        assert.match(failed.stderr, /Warning:.*security challenge detected/);
        assert.match(failed.stderr, /staging\/development environment/);
        assert.doesNotMatch(failed.stderr + failed.stdout, /retrying/);
        assert.equal(f.requests.filter(url => url === '/two').length, 1);
        assert.deepEqual(await readReferences(), references);
        assert.equal(await fs.readFile(historyPath, 'utf8'), history);
        await assert.rejects(fs.access(path.join(f.directory, '.reg/run/capture-manifest.json')), { code: 'ENOENT' });
        await assert.rejects(fs.access(path.join(f.directory, '.reg/run/out.json')), { code: 'ENOENT' });
      }
    }
  }
  await f.run(['approve'], 1);
  assert.deepEqual(await readReferences(), references);
});

test('header challenges stop navigation even when network-idle readiness never completes', async t => {
  const f = await fixture(t);
  f.config.scenarios = [{ url: '/one' }];
  f.config.defaults.waitUntil = 'networkidle0';
  f.config.defaults.navigationTimeout = 10000;
  f.pages['/one'] = { headers: { 'x-amzn-waf-action': 'challenge' }, status: 202,
    body: '<script>setInterval(() => fetch("/poll"), 20)</script><h1>Verification</h1>' };
  await f.save();
  const failed = await f.run(['reference'], 1);
  assert.match(failed.stderr, /AWS WAF security challenge detected/);
  assert.doesNotMatch(failed.stderr, /Phase: navigation/);
  assert.deepEqual(await f.files(), []);
});

test('DOM-only and late challenges cannot be hidden by configured page edits', async t => {
  const f = await fixture(t);
  f.config.scenarios = [{ url: '/one' }];
  f.pages['/one'] = cloudflare;
  await f.save();
  assert.match((await f.run(['reference'], 1)).stderr, /Cloudflare security challenge detected/);
  f.pages['/one'] = '<h1>Initially a real page</h1>';
  const hook = path.join(f.directory, 'late-challenge.js');
  await fs.writeFile(hook, `module.exports = async page => {
    await page.setContent(${JSON.stringify(cloudflare)});
  };`);
  f.config.onReadyScript = [hook];
  f.config.defaults.removeSelectors = ['script', 'main'];
  await f.save();
  assert.match((await f.run(['test'], 1)).stderr, /Cloudflare security challenge detected/);
  await assert.rejects(fs.access(path.join(f.directory, '.reg/run/capture-manifest.json')), { code: 'ENOENT' });
});

test('the final rendering pass rechecks for challenges before writing a screenshot', async t => {
  const page = await pageFixture(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-challenge-render-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'capture.png');
  await page.setContent('<main style="height:1200px">Real page before rendering</main>');
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async options => {
    const result = await screenshot(options);
    if (!options.path) await page.setContent(cloudflare);
    return result;
  };
  await assert.rejects(captureScreenshot(page, { path: filename, fullPage: true }, () => assertNoChallenge(page)),
    error => error.code === 'EAGLEDIFF_CHALLENGE_DETECTED');
  assert.deepEqual(await fs.readdir(directory), []);
});
