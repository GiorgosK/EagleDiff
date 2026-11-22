# Elementor visual bug benchmark

A reproducible test bed for visual regression tools on a JavaScript-heavy
WordPress site: the [Hello Elementor](https://wordpress.org/themes/hello-elementor/)
theme with the free [Elementor](https://wordpress.org/plugins/elementor/) page
builder. Pages use widgets that move after the page loads: Swiper carousels with
autoplay, numbers that count up, animated progress bars, entrance animations,
tabs, accordions, toggles and lazy-loaded background images.

A small plugin, `visual-bugs`, adds 13 known bugs, one per page. Four other
pages stay unchanged as controls. See [the benchmark method](../../docs/benchmarks.md#method)
for how results are scored.

| Kind | Bugs |
| --- | --- |
| Content | counter counts to the wrong number, typo in an accordion title, progress bar at 75% instead of 80% |
| Images | broken team photo (HTTP 404), wrong image in a carousel slide, rounded image corners |
| Layout and text | animated heading font, 2px button shift, tab title spacing |
| Colour and missing | faded icons, missing alert box |
| Viewport | phone-only missing social icons, wide-screen-only extra footer space |

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
   at 360×640, 1024×768 and 1920×1080, full page. Take them twice and compare;
   any difference is a false alarm.
2. Add the bugs: `ddev wp plugin activate visual-bugs --path=web`
3. Compare against the references, and write each flagged page and viewport to
   a text file (`e03 phone`, or `e05 error` for a capture error).
4. Score it: `node benchmark/score.js wordpress-elementor flagged.txt`
5. Remove the bugs: `ddev wp plugin deactivate visual-bugs --path=web`

## Run with Eaglediff

```bash
cd benchmark/wordpress-elementor/eaglediff
eaglediff reference
eaglediff calibrate          # should pass
# add the bugs, then:
eaglediff test
node ../../score.js wordpress-elementor --eaglediff .
```

[eaglediff/config.json](eaglediff/config.json) is built by
`node benchmark/make-config.js wordpress-elementor` and uses Eaglediff's
defaults: the site needed no settings of its own.

## Results

Eaglediff 0.1.0, Chrome 157, Linux (2026-11-22), default settings:

| Check | Result |
| --- | --- |
| Clean site compared with itself, three times | 51/51 each time, pixel-identical |
| Bugs caught | 12 of 13 |
| False alarms on the control pages | 0 |

Still missed: rounded image corners (e11), which change fewer pixels than
`thresholdMaxPixels` allows.

What the benchmark found in Eaglediff: counters counting up were sometimes
captured mid-count (97 instead of 98), about one calibration in nine. The
`wait-for-counters` hook, added for this, waits until counters stop changing;
since then every calibration has been pixel-identical. Carousels, entrance
animations, progress bars and lazy-loaded backgrounds needed no changes.
