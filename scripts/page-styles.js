// The same hooks can install CSS before navigation and reapply it before capture.
module.exports = async function applyPageStyles(page, content, mode) {
  if (mode !== 'before') {
    await page.addStyleTag({ content });
    return;
  }
  await page.evaluateOnNewDocument(css => {
    const install = () => {
      if (!document.documentElement) return false;
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
      return true;
    };
    if (!install()) {
      const observer = new MutationObserver(() => {
        if (install()) observer.disconnect();
      });
      observer.observe(document, { childList: true });
    }
  }, content);
};
