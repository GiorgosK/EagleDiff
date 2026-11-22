const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const waitForCounters = require('../scripts/hooks/wait-for-counters');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');

// An Elementor-style counter that counts 0 → 98 over about a second, and one
// that never stops (a clock).
async function fixture(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<span class="elementor-counter-number" id="count">0</span>
    <span class="clock" id="clock">0</span>`);
  await page.evaluate(() => {
    const count = document.querySelector('#count');
    let value = 0;
    const timer = setInterval(() => {
      value = Math.min(98, value + 7);
      count.textContent = String(value);
      if (value === 98) clearInterval(timer);
    }, 80);
    let tick = 0;
    setInterval(() => { document.querySelector('#clock').textContent = String(++tick); }, 100);
  });
  return page;
}

const context = (scenario = {}, warnings = []) => ({
  scenario, config: { defaults: {} }, reportWarning: (code, message) => warnings.push({ code, message })
});

test('waits until a counting widget reaches its final value', async t => {
  const page = await fixture(t);
  await waitForCounters(page, context());
  assert.equal(await page.$eval('#count', element => element.textContent), '98');
});

test('[] disables the wait; a counter that never settles warns once the timeout ends', async t => {
  const page = await fixture(t);
  await waitForCounters(page, context({ counterSelectors: [] }));
  assert.notEqual(await page.$eval('#count', element => element.textContent), '98', 'no wait when disabled');

  const warnings = [];
  const started = Date.now();
  await waitForCounters(page, context({ counterSelectors: ['#clock'], counterTimeout: 700 }, warnings));
  assert.ok(Date.now() - started < 3000, 'the wait is bounded by counterTimeout');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'counters-not-settled');
  assert.match(warnings[0].message, /still changing after 700ms/);

  await assert.rejects(waitForCounters(page, context({ counterTimeout: 0 })), /counterTimeout must be a positive number/);
});

test('config-update adds the hook and its settings to existing configs', () => {
  const updated = updateConfig({ defaults: {}, onReadyScript: ['hooks/wait-for-stable-content', 'hooks/keep-selectors'] }, template);
  assert.ok(updated.onReadyScript.includes('hooks/wait-for-counters'));
  assert.ok(updated.onReadyScript.indexOf('hooks/wait-for-counters') < updated.onReadyScript.indexOf('hooks/keep-selectors'));
  assert.equal(updated.defaults.counterSelectors, null);
  assert.equal(updated.defaults.counterTimeout, 10000);
});
