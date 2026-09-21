const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getScreenshotFileName: filename, validateScreenshotNames } = require('../scripts/run');

const viewport = { label: 'tablet', width: 1024, height: 768 };

test('URL identity replaces labels and survives renamed labels', () => {
  const movie = { url: '/movies/all', label: '\u03a4\u03b1\u03b9\u03bd\u03af\u03b5\u03c2' };
  const show = { url: '/shows/ellinikes-seires', label: '\u03a3\u03b5\u03b9\u03c1\u03ad\u03c2' };
  assert.notEqual(filename(movie, viewport), filename(show, viewport));
  assert.equal(filename(movie, viewport), filename({ ...movie, label: 'Renamed' }, viewport));
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
    scenarios: [{ url: '/', label: 'One' }, { url: '/', label: 'Two' }], viewports: [viewport]
  }), /Duplicate screenshot identity/);
});
