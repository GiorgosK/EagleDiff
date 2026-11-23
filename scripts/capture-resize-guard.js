// Eaglediff sets the viewport before navigation and never changes it. Chrome's
// beyond-viewport capture (full-page screenshots) still resizes the window
// briefly, firing resize and media query change events. Responsive scripts
// react as if the visitor had resized the window: GSAP matchMedia reverts and
// replays its animations, ScrollTrigger refreshes, sliders re-measure. The
// screenshot taken next then shows them part-way. Installed before navigation,
// this guard keeps those events from page scripts. CSS still follows the
// viewport natively.
function installResizeGuard() {
  if (window.__eaglediffResizeGuard) return;
  window.__eaglediffResizeGuard = true;
  // Registered before any page script, so they run first at the target.
  const stop = event => event.stopImmediatePropagation();
  window.addEventListener('resize', stop, true);
  window.visualViewport?.addEventListener('resize', stop, true);

  const proto = MediaQueryList.prototype;
  const wrappers = new WeakMap();
  // The listener is kept (so removeEventListener works) but never called.
  const wrap = listener => {
    if (!listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function')) return listener;
    if (!wrappers.has(listener)) wrappers.set(listener, () => {});
    return wrappers.get(listener);
  };
  const unwrap = listener => wrappers.get(listener) || listener;
  const addEventListener = proto.addEventListener;
  const removeEventListener = proto.removeEventListener;
  proto.addEventListener = function (type, listener, options) {
    return addEventListener.call(this, type, type === 'change' ? wrap(listener) : listener, options);
  };
  proto.removeEventListener = function (type, listener, options) {
    return removeEventListener.call(this, type, type === 'change' ? unwrap(listener) : listener, options);
  };
  const addListener = proto.addListener;
  const removeListener = proto.removeListener;
  proto.addListener = function (listener) { return addListener.call(this, wrap(listener)); };
  proto.removeListener = function (listener) { return removeListener.call(this, unwrap(listener)); };
  const onchange = Object.getOwnPropertyDescriptor(proto, 'onchange');
  if (onchange?.set) {
    const handlers = new WeakMap();
    Object.defineProperty(proto, 'onchange', {
      configurable: true,
      enumerable: onchange.enumerable,
      get() { return handlers.get(this) ?? null; },
      set(listener) { handlers.set(this, listener); }
    });
  }
}

module.exports = async function guardCaptureResizes(page) {
  await page.evaluateOnNewDocument(installResizeGuard);
};
module.exports.installResizeGuard = installResizeGuard;
