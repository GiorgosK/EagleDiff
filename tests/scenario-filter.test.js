const assert = require('node:assert/strict');
const { test } = require('node:test');
const { filterScenarios } = require('../scripts/run');

const config = {
  referenceBaseURL: 'https://catalog.example.test',
  testBaseURL: 'https://preview.catalog.example.test'
};
const select = (scenarios, text, settings = config) => filterScenarios(scenarios, text, settings).scenarios;

test('filters exclude base and absolute URL hosts, including generated labels', () => {
  const scenarios = [
    { url: '/', label: 'Homepage' },
    { url: '/catalog', label: 'Products' },
    { url: 'https://catalog.example.test/contact' },
    { referenceUrl: 'https://catalog.example.test/about' },
    { url: '/help', referenceUrl: 'https://catalog.example.test/support' }
  ];
  assert.deepEqual(select(scenarios, 'catalog'), [scenarios[1]]);
  assert.deepEqual(select(scenarios, 'contact'), [scenarios[2]]);
  assert.deepEqual(select(scenarios, 'about'), [scenarios[3]]);
  assert.deepEqual(select(scenarios, 'support'), [scenarios[4]]);
  for (const host of ['example.test', 'preview', 'https://catalog.example.test']) {
    assert.throws(() => select(scenarios, host), /No scenarios matched filter/);
  }
});

test('labels, IDs, query strings, fragments and comma alternatives still match case-insensitively', () => {
  const scenarios = [
    { url: '/one', label: 'Catalog overview' },
    { url: '/two', id: 'catalog-variant' },
    { url: 'https://example.test/three?section=catalog#details' },
    { url: '/four', referenceUrl: 'https://example.test/source?layout=compact#preview' }
  ];
  assert.deepEqual(select(scenarios, 'CATALOG'), scenarios.slice(0, 3));
  assert.deepEqual(select(scenarios, ' details , compact '), scenarios.slice(2));
  assert.deepEqual(select(scenarios, '#preview'), [scenarios[3]]);
  assert.deepEqual(select(scenarios, ''), scenarios);
  assert.deepEqual(select([{ url: '/news/item' }], 'news item'), [{ url: '/news/item' }]);
  assert.deepEqual(select([{ url: '/item' }], 'section', {
    referenceBaseURL: 'https://example.test/section', testBaseURL: 'https://example.test'
  }), [{ url: '/item' }]);
});

test('CLI filtering excludes domains before capture and keeps absolute-URL page matching', async t => {
  const f = await require('./helpers/cli-fixture')(t);
  f.config.scenarios[0].url = f.baseURL + '/one';
  await f.save();
  for (const command of ['reference', 'test', 'calibrate', 'approve']) {
    const result = await f.run([command, '--filter=127.0.0.1'], 1);
    assert.match(result.stderr, /No scenarios matched filter/);
  }
  assert.deepEqual(f.requests, [], 'domain-only filters must not start captures');
  await f.run(['reference', '--filter=one']);
  assert.equal((await f.files()).length, 1);
  assert(f.requests.includes('/one'));
  assert(!f.requests.includes('/two'));
});
