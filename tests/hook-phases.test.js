const assert = require('node:assert/strict');
const { test } = require('node:test');
const { planReadyHooks } = require('../scripts/hook-phases');
const { resolveHookPath } = require('../scripts/hook-path');
const { helperDir } = require('../scripts/config-path');
const template = require('../config-default.json');

const resolve = spec => resolveHookPath(spec, { helperDir, rootDir: '/project' });

test('default hooks: iframe, SVG and clipping hooks wait for the final DOM; image and font checks repeat', () => {
  const plan = planReadyHooks(template.onReadyScript, resolve);
  for (const deferred of ['hooks/prepare-iframes', 'hooks/stabilize-svg-animations', 'hooks/keep-selectors']) {
    assert.ok(!plan.configured.includes(deferred), deferred);
  }
  assert.deepEqual(plan.iframes, ['hooks/prepare-iframes']);
  assert.deepEqual(plan.keep, ['hooks/keep-selectors']);
  // The final image pass keeps the configured order of the image hooks.
  assert.deepEqual(plan.images, ['hooks/load-lazy-images', 'hooks/normalize-responsive-images',
    'hooks/normalize-image-decoding', 'hooks/wait-for-background-images']);
  assert.deepEqual(plan.fonts, ['hooks/wait-for-fonts']);
  assert.ok(plan.configured.includes('hooks/wait-for-fonts'));
});

test('removed bundled hooks have no later pass, and custom hooks run once in configured order', () => {
  const plan = planReadyHooks(['./custom-images', 'scripts/hooks/load-lazy-images.js', 'hooks/keep-selectors'], resolve);
  assert.deepEqual(plan.configured, ['./custom-images', 'scripts/hooks/load-lazy-images.js']);
  assert.deepEqual(plan.images, ['scripts/hooks/load-lazy-images.js']);
  assert.deepEqual([plan.fonts, plan.media, plan.animations, plan.iframes, plan.svg], [[], [], [], [], []]);
  assert.deepEqual(plan.keep, ['hooks/keep-selectors']);
});
