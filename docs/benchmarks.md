# Benchmarks

A visual regression tool can fail in two ways: it misses a real change, or it
flags a page that did not change (a false alarm). The benchmarks measure both on
demo sites that anyone can install.

Each benchmark adds known visual bugs to a clean site, one per page, and keeps
some pages unchanged as controls. The bugs live in the site (a Drupal module or a
WordPress plugin), not in Eaglediff, so any tool can be scored the same way.

## Method

1. Install the clean site with the benchmark's `setup.sh` (needs
   [DDEV](https://ddev.com/)).
2. Take reference screenshots of every page in its `bugs.json` at three
   viewports (360×640, 1024×768, 1920×1080), full page.
3. Compare the clean site with the references. Anything flagged here is a false
   alarm caused by the tool or by the site changing between visits.
4. Switch the bugs on, compare again, and score the result with
   [`benchmark/score.js`](../benchmark/score.js).

A bug counts as found when the tool flags its page on at least one viewport
where the bug changes pixels. `bugs.json` lists those viewports (`visibleAt`).
They were measured with Eaglediff at zero thresholds
([`benchmark/ground-truth.js`](../benchmark/ground-truth.js)), after the clean
site gave pixel-identical screenshots twice. A capture error on a bug page, such
as a broken image, also counts as found.

The bugs cover layout shifts of 1–2 pixels, changed fonts and spacing, faded
colours, a typo, missing elements, broken and swapped images, and bugs that
appear only on phones or only on wide screens.

## Results

| Benchmark | Bugs found | False alarms | Site-specific settings |
| --- | --- | --- | --- |
| [Drupal 11 Umami](../benchmark/drupal-umami/README.md) | 18 of 19 | 0 | none |

Eaglediff 0.1.0 with default settings, Chrome 157 on Linux, 2026-11-22.

The bug still missed changes about 80 pixels: an image's corners rounded by
8px. Before `thresholdMaxPixels` (see
[comparison thresholds](configuration.md#comparison-thresholds)), Eaglediff
found 14 of 19; the four extra bugs it now finds each change 500–1,600 pixels
on long full-page screenshots.

## Settings for each benchmark

A benchmark's Eaglediff config is built by
[`benchmark/make-config.js`](../benchmark/make-config.js) from three sources:
Eaglediff's defaults, the benchmark's optional `eaglediff/defaults.json`, and
the pages in `bugs.json`. Anything tuned for a particular site is in that
`defaults.json` file, in the [team defaults](configuration.md#team-or-agency-defaults)
format, so it is easy to see what a site needed. The Umami benchmark needs no
such file.

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
