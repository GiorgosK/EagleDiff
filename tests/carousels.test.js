const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions } = require('../scripts/run');
const stabilize = require('../scripts/hooks/stabilize-carousels');
const { updateConfig } = require('../scripts/config-update');
const template = require('../config-default.json');

const context = scenario => ({ scenario: { carouselSettleDelayMs: 0, ...scenario }, config: { defaults: {} } });

async function fixture(t) {
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div class="swiper swiper-container" id="slides">Second slide</div><div class="carousel" id="unrelated">Unrelated</div>');
  await page.evaluate(() => {
    const root = document.querySelector('#slides');
    window.timer = setInterval(() => { root.textContent = 'Second slide'; }, 20);
    root.swiper = {
      autoplay: { stop() { clearInterval(window.timer); } },
      slideTo() { root.textContent = 'First slide'; }
    };
  });
  return page;
}

test('automatic detection pauses playback and resets a supported carousel, leaving unrelated classes alone', async t => {
  const page = await fixture(t);
  await stabilize(page, context({ carouselSelectors: null }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.$eval('#slides', root => root.textContent), 'First slide');
  assert.equal(await page.$eval('#unrelated', root => root.textContent), 'Unrelated');
});

test('empty selectors disable detection and explicit selectors restrict it', async t => {
  const page = await fixture(t);
  for (const carouselSelectors of [[], '', ['#unrelated']]) {
    await stabilize(page, context({ carouselSelectors }));
    assert.equal(await page.$eval('#slides', root => root.textContent), 'Second slide');
  }
  await stabilize(page, context({ carouselSelectors: ['#slides'] }));
  assert.equal(await page.$eval('#slides', root => root.textContent), 'First slide');
  await assert.rejects(stabilize(page, context({ carouselSettleDelayMs: -1 })), /non-negative/);
});

test('Unite Gallery controls stop playback and select the first item', async t => {
  const page = await fixture(t);
  await page.setContent('<div class="ug-gallery-wrapper"><button class="ug-button-play ug-stop-mode">Stop</button><button class="ug-thumb-wrapper">First</button><output>Second slide</output></div>');
  await page.evaluate(() => {
    const button = document.querySelector('.ug-button-play');
    window.timer = setInterval(() => { document.querySelector('output').textContent = 'Second slide'; }, 20);
    button.onclick = () => { clearInterval(window.timer); button.classList.remove('ug-stop-mode'); };
    document.querySelector('.ug-thumb-wrapper').onclick = event => {
      event.target.classList.add('ug-thumb-selected'); document.querySelector('output').textContent = 'First slide';
    };
  });
  await stabilize(page, context({}));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.$eval('output', element => element.textContent), 'First slide');
  assert.equal(await page.$('.ug-stop-mode'), null);
});

test('images inserted by a slide change are decoded, and broken images still fail', async t => {
  const page = await fixture(t);
  // Set the lazy source through the DOM to avoid HTML attribute quoting rules.
  await page.evaluate(() => {
    document.querySelector('#slides').swiper.slideTo = () => {
      const image = document.createElement('img');
      image.dataset.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"/>');
      document.querySelector('#slides').replaceChildren(image);
    };
  });
  await stabilize(page, context({}));
  assert.deepEqual(await page.$eval('img', image => [image.complete, image.naturalWidth, image.naturalHeight]), [true, 7, 9]);
  await page.evaluate(() => {
    document.querySelector('#slides').swiper.slideTo = () => { document.querySelector('img').src = 'data:image/png,broken'; };
  });
  await assert.rejects(stabilize(page, context({})), /Cannot load image before capture/);
});

test('config updates enable automatic detection only when no explicit choice exists', () => {
  assert.equal(updateConfig({}, template).defaults.carouselSelectors, null);
  for (const carouselSelectors of [[], ['.custom'], null]) {
    assert.deepEqual(updateConfig({ defaults: { carouselSelectors } }, template).defaults.carouselSelectors, carouselSelectors);
  }
});

test('supported library APIs pause playback and show the first slide', async t => {
  const page = await fixture(t);
  for (const library of ['slick', 'owl', 'bootstrap', 'fotorama', 'flickity', 'flexslider']) {
    await page.setContent('<div id="gallery">Second slide</div>');
    await page.evaluate(library => {
      const root = document.querySelector('#gallery');
      const classes = { slick: 'slick-slider', owl: 'owl-carousel', bootstrap: 'carousel', fotorama: 'fotorama', flickity: 'flickity-enabled', flexslider: 'flexslider' };
      root.className = classes[library];
      const timer = setInterval(() => { root.textContent = 'Second slide'; }, 20);
      const pause = () => clearInterval(timer);
      const select = index => { root.textContent = index === 0 ? 'First slide' : 'Wrong slide'; };
      const data = {};
      window.jQuery = () => ({ data: key => data[key], trigger: (event, args) => event === 'stop.owl.autoplay' ? pause() : select(args[0]) });
      window.bootstrap = undefined; window.Flickity = undefined;
      if (library === 'slick') root.slick = { slickPause: pause, slickGoTo: select };
      if (library === 'owl') data['owl.carousel'] = {};
      if (library === 'bootstrap') window.bootstrap = { Carousel: { getInstance: element => element === root ? { pause, to: select } : null } };
      if (library === 'fotorama') data.fotorama = { stopAutoplay: pause, show: options => select(options.index) };
      if (library === 'flickity') window.Flickity = { data: element => element === root ? { stopPlayer: pause, select } : null };
      if (library === 'flexslider') data.flexslider = { pause, flexAnimate: select };
    }, library);
    await stabilize(page, context({}));
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(await page.$eval('#gallery', root => root.textContent), 'First slide', library);
  }
});

test('scenario automatic detection overrides a disabled default and library failures remain visible', async t => {
  const page = await fixture(t);
  const options = context({ carouselSelectors: null });
  options.config.defaults.carouselSelectors = [];
  await stabilize(page, options);
  assert.equal(await page.$eval('#slides', root => root.textContent), 'First slide');
  await page.evaluate(() => {
    document.querySelector('#slides').swiper.slideTo = () => { throw new Error('Gallery reset failed'); };
  });
  await assert.rejects(stabilize(page, options), /Gallery reset failed/);
});

test('a Slick carousel caught mid-transition still returns to the first slide', async t => {
  const page = await fixture(t);
  await page.setContent('<div class="slick-slider" id="slick">Third slide</div>');
  await page.evaluate(() => {
    const root = document.querySelector('#slick');
    // Slick ignores slickGoTo while an autoplay transition is running and
    // waitForAnimate is true (its default).
    root.slick = {
      animating: true, options: { waitForAnimate: true },
      slickPause() {},
      slickGoTo(index) {
        if (this.animating && this.options.waitForAnimate) return;
        root.textContent = index === 0 ? 'First slide' : 'Other slide';
      }
    };
  });
  await stabilize(page, context({}));
  assert.equal(await page.$eval('#slick', root => root.textContent), 'First slide');
});
