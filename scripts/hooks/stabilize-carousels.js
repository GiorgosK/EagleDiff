const loadImages = require('./load-lazy-images');
const normalizeResponsiveImages = require('./normalize-responsive-images');
const normalizeImageDecoding = require('./normalize-image-decoding');
const waitForImages = require('./wait-for-background-images');

const automaticSelectors = [
  '.swiper', '.swiper-container', '.slick-slider', '.owl-carousel', '.carousel',
  '.fotorama', '.flickity-enabled', '.flexslider', '.ug-gallery-wrapper'
];

module.exports = async function stabilizeCarousels(page, context) {
  // null selects automatic detection; an explicit [] disables stabilization.
  const configured = context.scenario.carouselSelectors !== undefined
    ? context.scenario.carouselSelectors : context.config.defaults?.carouselSelectors;
  const selectors = configured ?? automaticSelectors;
  const list = (Array.isArray(selectors) ? selectors : [selectors]).map(String).map(selector => selector.trim()).filter(Boolean);
  if (!list.length) return;
  const delay = context.scenario.carouselSettleDelayMs ?? context.config.defaults?.carouselSettleDelayMs ?? 500;
  if (!Number.isFinite(delay) || delay < 0) throw new Error('carouselSettleDelayMs must be a non-negative number.');

  const count = await page.evaluate(currentSelectors => {
    const roots = new Set(currentSelectors.flatMap(selector => [...document.querySelectorAll(selector)]));
    let stabilized = 0;
    for (const element of roots) {
      const $ = window.jQuery;
      const data = name => $ ? $(element).data(name) : undefined;
      const swiper = element.swiper;
      const slick = element.slick || data('slick');
      const fotorama = data('fotorama');
      const flickity = window.Flickity?.data?.(element) || data('flickity');
      const flexslider = data('flexslider');
      const bootstrap = window.bootstrap?.Carousel?.getInstance?.(element) || data('bs.carousel');
      if (swiper && typeof swiper.slideTo === 'function') {
        swiper.autoplay?.stop?.();
        if (swiper.slideToLoop) swiper.slideToLoop(0, 0, false);
        else swiper.slideTo(0, 0, false);
      } else if (slick && typeof slick.slickGoTo === 'function') {
        slick.slickPause();
        slick.slickGoTo(0, true);
      } else if (data('owl.carousel') && $) {
        $(element).trigger('stop.owl.autoplay');
        $(element).trigger('to.owl.carousel', [0, 0, true]);
      } else if (bootstrap && typeof bootstrap.to === 'function') {
        bootstrap.pause();
        bootstrap.to(0);
      } else if (fotorama && typeof fotorama.show === 'function') {
        fotorama.stopAutoplay();
        fotorama.show({ index: 0, time: 0 });
      } else if (flickity && typeof flickity.select === 'function') {
        flickity.stopPlayer();
        flickity.select(0, false, true);
      } else if (flexslider && typeof flexslider.flexAnimate === 'function') {
        flexslider.pause();
        flexslider.flexAnimate(0, true, true);
      } else if (element.matches('.ug-gallery-wrapper')) {
        // Unite Gallery does not retain its API on the element. Use its own controls.
        const first = element.querySelector('.ug-thumb-wrapper');
        if (!first) continue;
        element.querySelector('.ug-default-button-play.ug-stop-mode, .ug-button-play.ug-stop-mode')?.click();
        if (!first.classList.contains('ug-thumb-selected')) first.click();
      } else {
        // A class name alone must not initialize or alter an unrelated component.
        continue;
      }
      if ($?.fn?.stop) $(element).find('*').addBack().stop(true, true);
      stabilized += 1;
    }
    return stabilized;
  }, list);
  if (!count) return;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  // Switching slides can introduce lazy sources and invalidate earlier image checks.
  await loadImages(page, context);
  await normalizeResponsiveImages(page, context);
  await normalizeImageDecoding(page, context);
  await waitForImages(page, context);
};
