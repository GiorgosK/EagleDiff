# Drupal Umami visual bug benchmark

A reproducible way to measure how well a visual regression tool catches real
visual bugs and how often it raises false alarms. It works with any tool:
the bugs live in the test site, not in Eaglediff.

The site is Drupal's [Umami demo](https://www.drupal.org/docs/umami-drupal-demonstration-installation-profile)
(food magazine, responsive and lazy images, web fonts, two languages). A small
Drupal module, `visual_bugs`, adds 19 known bugs, one per page. Six other pages
stay unchanged as controls.

## What it measures

- **Bugs caught:** a bug counts as caught when the tool flags its page on at
  least one viewport where the bug is visible. A capture error on that page
  (for example a broken image) also counts.
- **False alarms:** pages or viewports flagged where nothing changed.

[bugs.json](bugs.json) lists every page, its bug, and the viewports where the
bug changes pixels (`visibleAt`). These were measured with a pixel-exact
comparison: the clean site captured twice gave identical pixels, and every bug
changed pixels exactly where listed.

| Kind | Examples |
| --- | --- |
| Layout | 1px shift, 2px button shift, line height, overlapping text |
| Text | typo, letter spacing, justified text, underlined links |
| Colour | faded links, lighter text, faint shadow |
| Images | broken image (HTTP 404), wrong image, rounded corners |
| Missing | hidden badge, invisible menu item |
| Viewport | phone-only and wide-screen-only bugs, one below the fold |

## Setup

Requires [DDEV](https://ddev.com/). Create the clean site in an empty folder:

```bash
benchmark/drupal-umami/setup.sh ~/sites/eaglediff-umami
```

This installs Drupal 11.4.13 with the Umami profile at
`https://eaglediff-umami.ddev.site` and copies the module into the site, but does
not enable it yet.

## Run with any tool

1. Take reference screenshots of the clean site for every page in
   `bugs.json`, at 360×640, 1024×768 and 1920×1080, full page.
2. Add the bugs:

   ```bash
   ddev drush en visual_bugs -y && ddev drush cr
   ```

3. Compare against the references.
4. Write each flagged page and viewport to a text file, one per line
   (`b13 phone`), or `b05 error` for a capture error, then score it:

   ```bash
   node benchmark/score.js drupal-umami flagged.txt
   ```

5. Remove the bugs again with `ddev drush pmu visual_bugs -y && ddev drush cr`.

Run step 1 twice before adding the bugs to check that the tool is stable on the
clean site; any difference there is a false alarm.

## Run with Eaglediff

[eaglediff/config.json](eaglediff/config.json) has the same pages and viewports
and otherwise uses Eaglediff's defaults. Rebuild it after updating Eaglediff with
`node benchmark/make-config.js drupal-umami`.

```bash
cd benchmark/drupal-umami/eaglediff
eaglediff reference          # clean site
eaglediff calibrate          # should pass: no false alarms
# add the bugs (step 2 above), then:
eaglediff test
node ../../score.js drupal-umami --eaglediff .
```

The broken image (b05) is reported as a capture error; the other pages are
still compared and appear in the report.

## Results

Eaglediff 0.1.0, Chrome 157, Linux (2026-11-22):

| Setting | Bugs caught | False alarms |
| --- | --- | --- |
| Defaults (`thresholdMaxPixels: 500`) | 18/19 | 0 |
| Defaults without `thresholdMaxPixels` | 14/19 | 0 |
| Pixel-exact (`thresholdRate: 0`, `thresholdRateColor: 0`) | 19/19 | 0 |

Still missed with the defaults: rounded image corners (b12), which change about
80 pixels. Without the pixel cap, `thresholdRate: 0.001` (0.1% of a full-page
screenshot) also let through faded tag links, underlined links, a 2px button
shift, an invisible menu item, and the typo on phone and tablet.

The clean site gave identical pixels on every calibration, so no site-specific
settings were needed.

To record `visibleAt` again, run the clean site through `calibrate` with
`thresholdRate: 0`, `thresholdRateColor: 0` and `thresholdMaxPixels: null`, add
the bugs, run `test`, and then `node ../../ground-truth.js drupal-umami .`.
