const applyPageStyles = require('../page-styles');

module.exports = async function applyCssOverrides(page, context) {
  const css = context.scenario.cssOverrides ?? context.config.defaults?.cssOverrides ?? '';
  if (typeof css !== 'string') {
    throw new Error('cssOverrides must be a CSS string.');
  }
  if (css.trim()) {
    await applyPageStyles(page, css, context.mode);
  }
};
