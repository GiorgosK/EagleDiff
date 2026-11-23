# Benchmarks

A visual regression tool can fail in two ways: it misses a real change, or it
flags a page that did not change (a false alarm). The benchmarks measure both on
demo sites that anyone can install.

Each benchmark adds known visual bugs to a clean site, one per page, and keeps
some pages unchanged as controls. The bugs live in the site (a Drupal module, a
WordPress plugin, or the Svelte site's server), not in Eaglediff, so any tool can
be scored the same way.

## Method

1. Install the clean site with the benchmark's `setup.sh` (the Drupal and
   WordPress sites need [DDEV](https://ddev.com/); the Svelte site needs Node.js).
2. Take reference screenshots of every page in its `bugs.json` at three
   viewports (360×640, 1024×768, 1920×1080), full page.
3. Compare the clean site with the references (calibration). It must flag
   nothing: anything flagged is a false alarm caused by the tool or by the site
   changing between visits, and it would also blur the bug score.
4. Switch the bugs on, compare again, and score the result with
   [`benchmark/score.js`](../benchmark/score.js).

A bug counts as found when the tool flags its page on at least one viewport
where the bug changes pixels. `bugs.json` lists those viewports (`visibleAt`).
They were measured with Eaglediff at zero thresholds
([`benchmark/ground-truth.js`](../benchmark/ground-truth.js)), after the clean
site gave pixel-identical screenshots twice. A capture error on a bug page, such
as a broken image, also counts as found.

The bugs cover layout shifts of 1–2 pixels, changed fonts and spacing, faded
colours, a typo, missing elements, broken and swapped images, broken lazy images
and backgrounds below the fold, missing web font files, content added by
JavaScript after the page loads, and bugs that appear only on phones or only on
wide screens, a page that answers HTTP 500, and a change inside an embedded
iframe.

## Calibration and zero thresholds

A clean calibration comes first: a tool that flags the unchanged site cannot be
trusted on the bug pages either. Setting thresholds to 0 is not a way to score
higher. The demo sites happen to give pixel-identical screenshots between runs,
but most real sites differ slightly from one visit to the next (image decoding,
font rendering, animations, changing content), and zero thresholds turn those
differences into failed calibrations. The benchmarks use zero thresholds only to
record where each bug changes pixels.

## Results

| Benchmark | Bugs found | False alarms | Clean site compared with itself |
| --- | --- | --- | --- |
| [Drupal 11 Umami](../benchmark/drupal-umami/README.md) | 26 of 27 | 0 | 99/99, twice |
| [WordPress with Elementor](../benchmark/wordpress-elementor/README.md) (JavaScript widgets and animations) | 15 of 18 | 0 | 66/66, twice |
| [Svelte with GSAP](../benchmark/svelte-gsap/README.md) (scroll-driven animations, marquee, smooth scrolling) | 11 of 12 | 0 | 48/48, 20 times |

Eaglediff 0.1.0 with default settings and no site-specific configuration,
Chrome 157 on Linux, 2026-11-23.

Missed, because each changes fewer pixels or less colour than the default
[comparison thresholds](configuration.md#comparison-thresholds) allow:

- image corners rounded by 8px (about 80 pixels), on both sites;
- one digit or letter changed in small text (about 64 to 176 pixels);
- a button colour changed from `#61ce70` to `#57c266`.

## Settings for each benchmark

Each benchmark's `setup.sh` writes `eaglediff/config.json` with
[`benchmark/make-config.js`](../benchmark/make-config.js): Eaglediff's default
settings plus the site URL, viewports and pages from `bugs.json`. No site needs
any other setting.

```bash
node benchmark/make-config.js drupal-umami
```

## Running a benchmark with another tool

Write each page and viewport your tool flagged to a text file, one per line,
using the page ids from `bugs.json`:

```text
b13 phone
b13 tablet
b05 error
```

Then score it:

```bash
node benchmark/score.js drupal-umami flagged.txt
```
