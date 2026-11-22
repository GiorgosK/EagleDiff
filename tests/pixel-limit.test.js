const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const cliFixture = require('./helpers/cli-fixture');

// A 200x5000 page: thresholdRate 0.001 allows 1,000 changed pixels, so a
// clearly visible 20x20 box (400 pixels) passes the ratio on its own.
const page = box => `<style>body{margin:0;height:5000px;background:#fff}
  #box{position:absolute;top:2400px;left:90px;width:20px;height:20px;background:#000}</style>
  ${box ? '<div id="box"></div>' : ''}`;

async function setUp(t) {
  const fixture = await cliFixture(t);
  Object.assign(fixture.config, {
    core: { workers: 1, thresholdRate: 0.001, thresholdRateColor: 0 },
    defaults: { delay: 0, fullPage: true, waitUntil: 'load' },
    viewports: [{ label: 'narrow', width: 200, height: 500 }],
    scenarios: [{ url: '/one' }]
  });
  fixture.pages['/one'] = page(false);
  await fixture.save();
  await fixture.run(['reference']);
  fixture.pages['/one'] = page(true);
  return fixture;
}

const readResult = fixture => fs.readFile(path.join(fixture.directory, '.reg/run/out.json'), 'utf8').then(JSON.parse);

test('thresholdMaxPixels fails a small change on a long page that thresholdRate allows', async t => {
  const fixture = await setUp(t);

  await fixture.run(['test']);
  assert.equal((await readResult(fixture)).passedItems.length, 1, 'without a cap the ratio lets the box pass');

  fixture.config.core.thresholdMaxPixels = 1000;
  await fixture.save();
  await fixture.run(['test']);
  assert.equal((await readResult(fixture)).passedItems.length, 1, '400 changed pixels are within a 1,000 pixel cap');

  fixture.config.core.thresholdMaxPixels = 100;
  await fixture.save();
  const result = await fixture.run(['test'], 1);
  assert.match(result.stderr, /1 visual difference/);
  const saved = await readResult(fixture);
  assert.equal(saved.passedItems.length, 0);
  assert.equal(saved.failedItems.length, 1);
  assert.deepEqual(saved.diffItems, saved.failedItems);
  // The HTML report and the diff image show the failure too.
  const report = await fs.readFile(path.join(fixture.directory, '.reg/run/index.html'), 'utf8');
  assert.ok(report.includes('"hasFailed":true'), 'report lists the failed capture');
  await fs.access(path.join(fixture.directory, '.reg/run/diff', saved.failedItems[0]));
});

test('an invalid thresholdMaxPixels stops before any page is captured', async t => {
  const fixture = await cliFixture(t);
  for (const value of [-1, 1.5, '2000']) {
    fixture.config.core.thresholdMaxPixels = value;
    await fixture.save();
    const result = await fixture.run(['reference'], 1);
    assert.match(result.stderr, /core\.thresholdMaxPixels must be a whole number of pixels/);
  }
  assert.deepEqual(fixture.requests, []);
});
