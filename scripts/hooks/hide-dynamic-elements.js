const applyPageStyles = require('../page-styles');
const { bannerSelectors, resolveOptions } = require('../cookie-consent');

module.exports = async function hideDynamicElements(page, context) {
  const { mode } = resolveOptions(context.config, context.scenario);
  const selectors = getSelectors(context).filter(selector => mode === 'hide' || !bannerSelectors.includes(selector));
  if (!selectors.length) {
    return;
  }

  await applyPageStyles(page, `${selectors.join(',\n')} {\n  display: none !important;\n}`, context.mode);
};

function getSelectors(context) {
  if (Object.prototype.hasOwnProperty.call(context.scenario, 'hideDynamicSelectors')) {
    return normalizeSelectorList(context.scenario.hideDynamicSelectors);
  }

  if (Object.prototype.hasOwnProperty.call(context.config.defaults || {}, 'hideDynamicSelectors')) {
    return normalizeSelectorList(context.config.defaults.hideDynamicSelectors);
  }

  return [];
}

function normalizeSelectorList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
