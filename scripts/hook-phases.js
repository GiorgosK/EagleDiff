const path = require('path');
const { helperDir } = require('./config-path');

// Bundled ready hooks that the capture runs outside their configured position.
// Custom hooks always run once, in configured order.
//
// Deferred hooks skip the configured pass and run only near the end:
// they need the final DOM (iframes, SVG players, clipping).
const deferredHooks = {
  iframes: ['prepare-iframes'],
  svg: ['stabilize-svg-animations'],
  keep: ['keep-selectors']
};

// Repeated hooks run in the configured pass and again after late page changes
// (hide/remove selectors, injected content, iframes, carousels), so that new
// animations, media, images and fonts are settled before the screenshot. The
// image hooks form the one final "images ready" pass for the capture.
const repeatedHooks = {
  animations: ['freeze-web-animations'],
  media: ['pause-media'],
  images: ['load-lazy-images', 'normalize-responsive-images',
    'normalize-image-decoding', 'wait-for-background-images'],
  fonts: ['wait-for-fonts']
};

// Split configured ready hooks into the phases run by captureScenarioScreenshot.
// Each phase keeps the configured order and only contains configured hooks, so
// removing a bundled hook from onReadyScript also removes its later passes.
function planReadyHooks(readyScripts, resolveScriptPath) {
  const bundledPath = name => path.join(helperDir, 'scripts', 'hooks', `${name}.js`);
  const pick = names => {
    const paths = names.map(bundledPath);
    return readyScripts.filter(script => paths.includes(resolveScriptPath(script)));
  };
  const plan = {};
  for (const [phase, names] of Object.entries({ ...deferredHooks, ...repeatedHooks })) {
    plan[phase] = pick(names);
  }
  const deferred = new Set([...plan.iframes, ...plan.svg, ...plan.keep]);
  plan.configured = readyScripts.filter(script => !deferred.has(script));
  // Startup hooks (jQuery/Drupal ready) recheck lazy images only when the
  // project has the lazy-image hook; removing it turns those rechecks off too.
  plan.loadsLazyImages = pick(['load-lazy-images']).length > 0;
  return plan;
}

module.exports = { planReadyHooks, deferredHooks, repeatedHooks };
