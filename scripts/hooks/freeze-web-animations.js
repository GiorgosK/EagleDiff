function resolveOptions(config = {}, scenario = {}) {
  const enabled = scenario.freezeWebAnimations ?? config.defaults?.freezeWebAnimations ?? true;
  if (typeof enabled !== 'boolean') throw new Error('freezeWebAnimations must be a boolean.');
  return { enabled };
}

module.exports = async function freezeWebAnimations(page, context = {}) {
  if (!resolveOptions(context.config, context.scenario).enabled) return;
  await page.evaluate(async () => {
    const freeze = animation => {
      // Scroll/view timelines follow layout rather than elapsed time.
      if (!(animation.timeline instanceof DocumentTimeline)) return;
      // Set a resolved time before pausing, including infinite animations.
      animation.currentTime = 0;
      animation.pause();
      // Resolve a pending pause at zero instead of the next compositor sample.
      animation.currentTime = 0;
      return true;
    };
    if (!window.__eaglediffWebAnimationGuard) {
      const animate = Element.prototype.animate;
      const play = Animation.prototype.play;
      const reverse = Animation.prototype.reverse;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        freeze(animation);
        return animation;
      };
      Animation.prototype.play = function (...args) {
        if (freeze(this)) return;
        return play.apply(this, args);
      };
      Animation.prototype.reverse = function (...args) {
        // Reversing an infinite effect at time zero would otherwise throw.
        if (freeze(this)) return;
        return reverse.apply(this, args);
      };
      // CSS animations can start later without calling Element.animate().
      const freezeStartedAnimations = () => document.getAnimations().forEach(freeze);
      document.addEventListener('animationstart', freezeStartedAnimations, true);
      document.addEventListener('transitionrun', freezeStartedAnimations, true);
      // Wrappers belong to this document; disposing its context restores isolation.
      window.__eaglediffWebAnimationGuard = true;
    }
    document.getAnimations().forEach(freeze);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
};
module.exports.resolveOptions = resolveOptions;
