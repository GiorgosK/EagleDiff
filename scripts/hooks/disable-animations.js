module.exports = async function disableAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
      body {
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
      }
      * {
        text-rendering: geometricPrecision !important;
        -webkit-font-variant-ligatures: none !important;
        font-variant-ligatures: none !important;
        font-kerning: none !important;
      }
      @font-face {
        font-display: block !important;
      }
      html {
        overflow-y: scroll !important;
        -webkit-text-size-adjust: 100% !important;
      }
    `
  });
};
