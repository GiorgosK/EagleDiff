const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const cliFixture = require('./helpers/cli-fixture');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';

async function readReferences(directory) {
  const dir = path.join(directory, '.reg/reference');
  const names = (await fs.readdir(dir)).sort();
  return Promise.all(names.map(async name => [name, (await fs.readFile(path.join(dir, name))).toString('base64')]));
}

for (const workers of [1, 2]) {
  test(`a failed capture does not stop the other pages, and the run cannot be approved (${workers} worker${workers > 1 ? 's' : ''})`, async t => {
    const fixture = await cliFixture(t);
    Object.assign(fixture.pages, {
      '/two': '<img src="/pic.svg">',
      '/three': '<h1>Three</h1>',
      '/pic.svg': { headers: { 'Content-Type': 'image/svg+xml' }, body: svg }
    });
    fixture.config.core.workers = workers;
    fixture.config.onReadyScript = ['hooks/load-lazy-images'];
    fixture.config.scenarios = [{ url: '/one' }, { url: '/two' }, { url: '/three' }];
    await fixture.save();
    await fixture.run(['reference']);
    const references = await readReferences(fixture.directory);

    // A broken image on /two (permanent failure) and a real change on /three.
    fixture.pages['/pic.svg'] = { status: 404, body: 'Missing' };
    fixture.pages['/three'] = '<h1>Changed</h1>';
    const result = await fixture.run(['test'], 1);
    assert.match(result.stderr, /1 capture\(s\) failed, so this comparison is incomplete and cannot be approved/);
    assert.match(result.stderr, /The other pages have 1 visual difference\(s\)/);
    assert.match(result.stderr, /Capture failed.*two/);
    assert.match(result.stderr, /Hook: hooks\/load-lazy-images/);
    assert.match(require('./helpers/capture-log')(result.stderr), /Image response: HTTP 404/);
    assert.ok(fixture.requests.filter(url => url === '/three').length >= 2, '/three was captured after the failure');

    // The report shows the captured pages; the failed one has no new screenshot.
    const out = JSON.parse(await fs.readFile(path.join(fixture.directory, '.reg/run/out.json'), 'utf8'));
    assert.equal(out.failedItems.length, 1);
    assert.match(out.failedItems[0], /^three/);
    assert.equal(out.passedItems.length, 1);
    assert.match(out.passedItems[0], /^one/);
    assert.ok(out.deletedItems.some(name => name.startsWith('two')));
    await fs.access(path.join(fixture.directory, '.reg/run/index.html'));
    await assert.rejects(fs.access(path.join(fixture.directory, '.reg/run/capture-manifest.json')));

    const approve = await fixture.run(['approve'], 1);
    assert.match(approve.stderr, /No completed comparison to approve/);
    assert.deepEqual(await readReferences(fixture.directory), references, 'references are unchanged');
  });
}

test('a run stops once captures have failed on 10 pages', async t => {
  const fixture = await cliFixture(t);
  fixture.pages['/pic.svg'] = { headers: { 'Content-Type': 'image/svg+xml' }, body: svg };
  fixture.config.onReadyScript = ['hooks/load-lazy-images'];
  fixture.config.scenarios = Array.from({ length: 12 }, (_, index) => ({ url: `/page-${index}` }));
  for (const { url } of fixture.config.scenarios) fixture.pages[url] = '<img src="/pic.svg">';
  await fixture.save();
  await fixture.run(['reference']);
  fixture.pages['/pic.svg'] = { status: 404, body: 'Missing' };
  const result = await fixture.run(['test'], 1);
  assert.match(result.stderr, /Captures failed on 10 pages; stopping the run/);
  assert.equal(fixture.requests.filter(url => url.startsWith('/page-')).length, 12 + 10, 'the last two pages were not captured');
});

test('failed captures on a few pages at several viewports do not stop the run', async t => {
  const fixture = await cliFixture(t);
  fixture.pages['/pic.svg'] = { headers: { 'Content-Type': 'image/svg+xml' }, body: svg };
  fixture.config.onReadyScript = ['hooks/load-lazy-images'];
  fixture.config.viewports = [
    { label: 'phone', width: 360, height: 640 },
    { label: 'tablet', width: 768, height: 640 },
    { label: 'pc', width: 1024, height: 640 }
  ];
  // Four broken pages at three viewports: 12 failed captures, then a page
  // that still has to be captured and compared.
  fixture.config.scenarios = [0, 1, 2, 3].map(index => ({ url: `/broken-${index}` })).concat({ url: '/last' });
  for (const { url } of fixture.config.scenarios) fixture.pages[url] = '<img src="/pic.svg">';
  fixture.pages['/last'] = '<h1>Last</h1>';
  await fixture.save();
  await fixture.run(['reference']);
  fixture.pages['/pic.svg'] = { status: 404, body: 'Missing' };
  const result = await fixture.run(['test'], 1);
  assert.match(result.stderr, /12 capture\(s\) failed, so this comparison is incomplete/);
  assert.doesNotMatch(result.stderr, /stopping the run/);
  const out = JSON.parse(await fs.readFile(path.join(fixture.directory, '.reg/run/out.json'), 'utf8'));
  assert.equal(out.passedItems.filter(name => name.startsWith('last')).length, 3, '/last was compared at every viewport');
});
