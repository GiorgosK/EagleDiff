const applyPageStyles = require('../page-styles');

module.exports = async function hideDynamicElements(page, context) {
  if (context.scenario.keepCookiebot) {
    return;
  }

  const selectors = getSelectors(context);
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
