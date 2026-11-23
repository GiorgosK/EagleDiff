# Elementor visual bug benchmark

A reproducible test bed for visual regression tools on a JavaScript-heavy
WordPress site: the [Hello Elementor](https://wordpress.org/themes/hello-elementor/)
theme with the free [Elementor](https://wordpress.org/plugins/elementor/) page
builder. Pages use widgets that move after the page loads: Swiper carousels with
autoplay, numbers that count up, animated progress bars, entrance animations,
tabs, accordions, toggles and lazy-loaded background images.

A small plugin, `visual-bugs`, adds 18 known bugs, one per page. Four other
pages stay unchanged as controls. See [the benchmark method](../../docs/benchmarks.md#method)
for how results are scored.

| Kind | Bugs |
| --- | --- |
| Content | counter counts to the wrong number, typo in an accordion title, progress bar at 75% instead of 80% |
| Images | broken team photo (HTTP 404), wrong image in a carousel slide, rounded image corners, broken lazy-loaded background below the fold |
| Layout and text | animated heading font, 2px button shift, tab title spacing |
| Colour and missing | faded icons, slightly different button colour, missing alert box |
| Late content | notice bar added by JavaScript 2 seconds after load |
| Embeds | opening hours changed inside a lazy-loaded iframe |
| Viewport | phone-only missing social icons, wide-screen-only extra footer space, a title overflowing narrow screens |

[bugs.json](bugs.json) lists every page, its bug and the viewports where it
changes pixels.

## Setup

Requires [DDEV](https://ddev.com/). Create the clean site in an empty folder:

```bash
benchmark/wordpress-elementor/setup.sh ~/sites/eaglediff-elementor
```

This installs WordPress 7.1.5, Hello Elementor 3.5.2 and Elementor 4.4.1 from
wordpress.org at `https://eaglediff-elementor.ddev.site`, builds the pages with
[content.php](content.php) from images that ship with WordPress, and copies the
plugin into the site without activating it.

## Run with any tool

1. Take reference screenshots of the clean site for every page in `bugs.json`,
   at 360×640, 1024×768 and 1920×1080, full page, and compare the clean site
   with them (see "Calibrate first").
2. Add the bugs: `ddev wp plugin activate visual-bugs --path=web`
3. Compare against the references, and write each flagged page and viewport to
   a text file (`e03 phone`, or `e05 error` for a capture error).
4. Score it: `node benchmark/score.js wordpress-elementor flagged.txt`
5. Remove the bugs: `ddev wp plugin deactivate visual-bugs --path=web`

## Calibrate first

Before adding the bugs, compare the clean site with itself. It must report no
differences. A difference there is a false alarm, and it also makes the bug
score meaningless: a flagged bug page may only be showing the same noise.

Do not set the thresholds to 0 to make a tool look more sensitive. These demo
sites happen to give pixel-identical screenshots between runs, but most real
sites differ slightly from one visit to the next (image decoding, font
rendering, animations, changing content). With zero thresholds those natural
differences fail calibration. Zero thresholds are used here only to record
where each bug changes pixels (`visibleAt`).

## Run with Eaglediff

`setup.sh` writes `eaglediff/config.json` with
`node benchmark/make-config.js wordpress-elementor`: Eaglediff's default settings plus the site
URL, viewports and pages from [bugs.json](bugs.json), nothing else. Run it again
after updating Eaglediff.

```bash
cd benchmark/wordpress-elementor/eaglediff
eaglediff reference          # clean site
eaglediff calibrate          # must pass: see "Calibrate first"
# add the bugs, then:
eaglediff test
node ../../score.js wordpress-elementor --eaglediff .
```

## Results

Eaglediff 0.1.0 with default settings, Chrome 157, Linux (2026-11-23):

| Check | Result |
| --- | --- |
| Clean site compared with itself, twice | 66/66 each time |
| Bugs caught | 15 of 18 |
| False alarms on the control pages | 0 |

Missed:

- rounded image corners (e11): about 80 changed pixels, fewer than
  `thresholdMaxPixels: 500` allows;
- one digit changed in the embedded opening hours (e18): about 64 changed
  pixels, also under `thresholdMaxPixels`;
- the slightly different button green (e17): each pixel's colour changes less
  than `thresholdRateColor: 0.05` counts. `thresholdRateColor: 0.04` catches it.

To record `visibleAt` again, run the clean site through `calibrate` with
`thresholdRate: 0`, `thresholdRateColor: 0` and `thresholdMaxPixels: null`, add
the bugs, run `test`, and then `node ../../ground-truth.js wordpress-elementor <that folder>`.
