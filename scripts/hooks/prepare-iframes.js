const { resolveOptions, prepareIframes } = require('../iframe-capture');

module.exports = async function prepareIframeCapture(page, context) {
  if (context.mode !== 'ready') return;
  context.hasVisibleIframes = await prepareIframes(page, resolveOptions(context.config, context.scenario));
};
