module.exports = async function stabilizeCarousels(page, context) {
  const selectors =
    context.scenario.carouselSelectors ||
    context.config.defaults?.carouselSelectors || [
      '.swiper',
      '.swiper-container',
      '.slick-slider',
      '.owl-carousel',
      '.carousel'
    ];

  const settleDelayMs =
    context.scenario.carouselSettleDelayMs ||
    context.config.defaults?.carouselSettleDelayMs ||
    500;

  const list = Array.isArray(selectors) ? selectors : [selectors];
  const filtered = list.map((selector) => String(selector).trim()).filter(Boolean);

  await page.evaluate((currentSelectors) => {
    const pauseSwiper = (element) => {
      if (!element.swiper) return;

      try {
        if (element.swiper.autoplay && element.swiper.autoplay.stop) {
          element.swiper.autoplay.stop();
        }
        if (element.swiper.slideTo) {
          element.swiper.slideTo(0, 0, false);
        }
      } catch (error) {
        // Ignore library-specific failures.
      }
    };

    const pauseSlick = (element) => {
      try {
        if (window.jQuery && window.jQuery(element).slick) {
          window.jQuery(element).slick('slickPause');
          window.jQuery(element).slick('slickGoTo', 0, true);
        }
      } catch (error) {
        // Ignore library-specific failures.
      }
    };

    const pauseOwl = (element) => {
      try {
        if (window.jQuery) {
          const $element = window.jQuery(element);
          $element.trigger('stop.owl.autoplay');
          $element.trigger('to.owl.carousel', [0, 0, true]);
        }
      } catch (error) {
        // Ignore library-specific failures.
      }
    };

    const pauseBootstrapCarousel = (element) => {
      try {
        if (window.jQuery && window.jQuery.fn && window.jQuery.fn.carousel) {
          const $element = window.jQuery(element);
          $element.carousel('pause');
          $element.carousel(0);
        }
      } catch (error) {
        // Ignore library-specific failures.
      }
    };

    currentSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        pauseSwiper(element);
        pauseSlick(element);
        pauseOwl(element);
        pauseBootstrapCarousel(element);
      });
    });
  }, filtered);

  await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
};
