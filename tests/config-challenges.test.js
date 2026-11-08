const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const fixture = require('./helpers/cli-fixture');

const cloudflare = '<title>Just a moment...</title><script type="application/json" src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script><a href="/verification">Verification link</a>';

test('blocked discovery creates no partial config and preserves existing config and gitignore', async t => {
  const f = await fixture(t);
  const configPath = path.join(f.directory, 'config.json');
  const gitignorePath = path.join(f.directory, '.gitignore');
  const original = await fs.readFile(configPath);
  await fs.writeFile(gitignorePath, 'existing-entry\n');
  for (const [provider, page] of [
    ['Cloudflare', { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: '<h1>Verification</h1>' }],
    ['AWS WAF', { status: 202, headers: { 'x-amzn-waf-action': 'captcha' }, body: '<h1>Verification</h1>' }],
    ['Cloudflare', cloudflare]
  ]) {
    for (const existing of [false, true]) {
      if (existing) await fs.writeFile(configPath, original);
      else await fs.rm(configPath, { force: true });
      f.pages['/'] = page; f.requests.length = 0;
      const result = await f.run(['config', '--ref=' + f.baseURL], 1);
      assert.match(result.stderr, new RegExp(provider + ' security challenge detected'));
      assert.match(result.stderr, /Page\s+discovery\s+stopped/);
      assert.doesNotMatch(result.stdout, /Wrote config|retrying/);
      assert.equal(f.requests.filter(url => url === '/').length, 1);
      if (existing) assert.deepEqual(await fs.readFile(configPath), original);
      else await assert.rejects(fs.access(configPath), { code: 'ENOENT' });
      assert.equal(await fs.readFile(gitignorePath, 'utf8'), 'existing-entry\n');
      await assert.rejects(fs.access(path.join(f.directory, '.reg')), { code: 'ENOENT' });
    }
  }
});

test('late challenges on a second source discard all partial discovery results', async t => {
  const f = await fixture(t);
  f.pages['/'] = '<a href="/legitimate-page">Legitimate page</a>';
  f.pages['/blocked'] = `<a href="/wrong-page">Not a website page</a><script>
    setTimeout(() => { window._cf_chl_opt = {}; document.body.innerHTML = '<form id="challenge-form">Verifying</form>'; }, 50);
  </script>`;
  f.config.testBaseURL = f.baseURL + '/blocked'; await f.save();
  const configPath = path.join(f.directory, 'config.json');
  const original = await fs.readFile(configPath);
  const result = await f.run(['config'], 1);
  assert.match(result.stderr, /Cloudflare security challenge detected[\s\S]*\/blocked/);
  assert(f.requests.includes('/') && f.requests.includes('/blocked'));
  assert.deepEqual(await fs.readFile(configPath), original);
  await assert.rejects(fs.access(path.join(f.directory, '.gitignore')), { code: 'ENOENT' });
});

test('ordinary CDN headers, normal challenge-platform scripts and legitimate one-page sites remain allowed', async t => {
  const f = await fixture(t);
  const configPath = path.join(f.directory, 'config.json');
  await fs.unlink(configPath);
  f.pages['/'] = { headers: { server: 'cloudflare', 'cf-ray': 'ordinary-cdn-response' }, body:
    '<h1>A one-page website</h1><div class="cf-turnstile"></div><script type="application/json" src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>' };
  await f.run(['config', '--ref=' + f.baseURL]);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath)).scenarios.map(scenario => scenario.url), ['/']);
  f.pages['/'].body += '<a href="/news">News</a><a href="/download.pdf">Download</a>';
  await f.run(['config']);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath)).scenarios.map(scenario => scenario.url), ['/', '/news']);
});

test('challenge headers interrupt discovery navigation even when the document never finishes loading', async t => {
  const f = await fixture(t);
  let responseClosed = false;
  const server = http.createServer((request, response) => {
    response.once('close', () => { responseClosed = true; });
    response.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' });
    response.flushHeaders();
    response.write('<html><body>Waiting for verification'); // Deliberately leave the stream open.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const original = await fs.readFile(path.join(f.directory, 'config.json'));
  const result = await f.run(['config', `--links=http://127.0.0.1:${server.address().port}/`], 1);
  assert.match(result.stderr, /Cloudflare security challenge detected/);
  assert.doesNotMatch(result.stderr, /Navigation timeout/);
  assert(responseClosed, 'closing the discovery page cancels the unfinished challenge document');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'config.json')), original);
});

test('discovery sources retain their shared browser session', async t => {
  const f = await fixture(t);
  f.pages['/'] = { headers: { 'Set-Cookie': 'discovery=ready; Path=/' }, body: '<h1>First source</h1>' };
  f.pages['/follow'] = `<main>Second source</main><script>
    const href = document.cookie.includes('discovery=ready') ? '/with-session' : '/without-session';
    document.body.insertAdjacentHTML('beforeend', '<a href="' + href + '">Session result</a>');
  </script>`;
  f.config.testBaseURL = f.baseURL + '/follow'; await f.save();
  await f.run(['config']);
  const config = JSON.parse(await fs.readFile(path.join(f.directory, 'config.json')));
  assert(config.scenarios.some(scenario => scenario.url === '/with-session'));
  assert(!config.scenarios.some(scenario => scenario.url === '/without-session'));
});
