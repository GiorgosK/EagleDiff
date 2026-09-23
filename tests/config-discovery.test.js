const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeLink } = require('../scripts/config');

const base = 'https://example.org/';

test('rejects Cookiebot placeholders before their fragments hide the token', () => {
  assert.equal(normalizeLink(base, {
    href: '[#DSR_FORM_URL#]', text: '[#DSR_FORM_URL_TEXT#]'
  }), null);
  assert.equal(normalizeLink(base, { href: '/[', text: 'Broken link' }), null);
  assert.equal(normalizeLink(base, { href: '/%5B', text: 'Broken link' }), null);
});

test('rejects raw and encoded template URLs and unresolved labels', () => {
  for (const href of ['/{{page}}', '/${page}', '/<%= page %>', '/%5B%23PAGE%23%5D']) {
    assert.equal(normalizeLink(base, { href }), null, href);
  }
  for (const field of ['text', 'title', 'ariaLabel']) {
    assert.equal(normalizeLink(base, { href: '/page', [field]: '[#LABEL#]' }), null);
  }
});

test('keeps valid internal links, queries, fragments and balanced brackets', () => {
  for (const [href, url] of [
    ['/services/#contact', '/services'],
    ['/search?filters[type]=news', '/search?filters[type]=news'],
    ['/docs/[section]', '/docs/[section]'],
    ['/news?text=%23update', '/news?text=%23update']
  ]) {
    assert.deepEqual(normalizeLink(base, { href, text: 'Useful page' }), { url, label: 'Useful page' });
  }
  for (const href of ['mailto:info@example.org', 'javascript:void(0)', 'https://elsewhere.org/page', '#menu']) {
    assert.equal(normalizeLink(base, { href }), null);
  }
});
