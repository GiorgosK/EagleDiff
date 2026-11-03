const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getScreenshotFileName: filename, validateScreenshotNames } = require('../scripts/run');

const viewport = { label: 'tablet', width: 1024, height: 768 };

test('URL and label together distinguish scenarios', () => {
  const movie = { url: '/movies/all', label: '\u03a4\u03b1\u03b9\u03bd\u03af\u03b5\u03c2' };
  const show = { url: '/shows/ellinikes-seires', label: '\u03a3\u03b5\u03b9\u03c1\u03ad\u03c2' };
  assert.notEqual(filename(movie, viewport), filename(show, viewport));
  assert.notEqual(filename(movie, viewport), filename({ ...movie, label: 'Renamed' }, viewport));
  assert.match(filename(movie, viewport), /^movies-all--[a-f0-9]{16}__tablet\.png$/);
});

test('transliterated names remain distinct despite punctuation and query collisions', () => {
  const greek = '/\u03bd\u03ad\u03b1';
  assert.match(filename({ url: greek }, viewport), /^nea--/);
  assert.match(filename({ url: encodeURI(greek) }, viewport), /^nea--/);
  const urls = [greek, '/nea', '/a/b', '/a-b', '/a?b=1', '/a?b=2', '/A', '/a', '/a#one', '/a#two'];
  assert.equal(new Set(urls.map(url => filename({ url }, viewport))).size, urls.length);
  assert.match(filename({ url: '/' }, viewport), /^homepage--/);
  assert(filename({ url: '/' + 'a'.repeat(500) }, viewport).length < 255);
});

test('viewport identity prevents collisions and exact duplicates fail early', () => {
  assert.notEqual(filename({ url: '/' }, viewport), filename({ url: '/' }, { ...viewport, width: 800 }));
  assert.throws(() => validateScreenshotNames({
    scenarios: [{ url: '/', label: 'One' }, { url: '/', label: 'One' }], viewports: [viewport]
  }), /Duplicate screenshot identity/);
});

test('different labels distinguish same-URL variants while unlabeled filenames stay unchanged', () => {
  assert.equal(filename({ url: '/courses' }, viewport), 'courses--7e7f6387f9bd6b06__tablet.png');
  const variants = [{ url: '/courses', label: 'Standard' }, { url: '/courses', label: 'Expanded' }];
  validateScreenshotNames({ scenarios: variants, viewports: [viewport] });
  assert.notEqual(filename(variants[0], viewport), filename(variants[1], viewport));
  assert.notEqual(filename(variants[0], viewport), filename({ url: '/courses' }, viewport));
  assert.throws(() => validateScreenshotNames({ scenarios: [variants[0], variants[0]], viewports: [viewport] }), /distinct labels or IDs/);
});

test('labels remain distinct despite punctuation or transliteration collisions', () => {
  const labels = ['Courses A', 'Courses-A', 'Μαθήματα', 'Mathimata'];
  assert.equal(new Set(labels.map(label => filename({ url: '/courses', label }, viewport))).size, labels.length);
});

test('optional IDs distinguish repeated URL/label pairs without colliding with labels', () => {
  const first = { url: '/courses', label: 'Courses', id: 'one' };
  const second = { ...first, id: 'two' };
  assert.notEqual(filename(first, viewport), filename(second, viewport));
  assert.notEqual(filename({ url: '/courses', label: 'one' }, viewport), filename({ url: '/courses', id: 'one' }, viewport));
  assert.throws(() => validateScreenshotNames({ scenarios: [first, first], viewports: [viewport] }), /Duplicate screenshot identity/);
  for (const id of ['', ' ', null, 0, false, [], {}]) {
    assert.throws(() => validateScreenshotNames({ scenarios: [{ url: '/courses', id }], viewports: [] }), /Invalid scenario id/);
  }
});
