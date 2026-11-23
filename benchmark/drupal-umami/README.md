# Drupal Umami visual bug benchmark

A reproducible way to measure how well a visual regression tool catches real
visual bugs and how often it raises false alarms. It works with any tool:
the bugs live in the test site, not in Eaglediff.

The site is Drupal's [Umami demo](https://www.drupal.org/docs/umami-drupal-demonstration-installation-profile)
(food magazine, responsive and lazy images, web fonts, two languages). A small
Drupal module, `visual_bugs`, adds 27 known bugs, one per page. Six other pages
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
| Colour | faded links, lighter text, lighter grey body text, faint shadow |
| Images | broken image (HTTP 404), broken lazy image below the fold, wrong image, rounded corners, a blurry image on wide screens only (wrong `srcset` candidate) |
| Fonts | font family changed, web font file missing (HTTP 404) |
| Missing | hidden badge, invisible menu item |
| Errors | a page that answers HTTP 500 |
| Late content | notice bar and fixed newsletter box added by JavaScript after the page loads |
| Viewport | phone-only and wide-screen-only bugs, a title overflowing narrow screens |

Some pages are Spanish, including a URL with an accented letter.

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
`node benchmark/make-config.js drupal-umami`: Eaglediff's default settings plus the site
URL, viewports and pages from [bugs.json](bugs.json), nothing else. Run it again
after updating Eaglediff.

```bash
cd benchmark/drupal-umami/eaglediff
eaglediff reference          # clean site
eaglediff calibrate          # must pass: see "Calibrate first"
# add the bugs, then:
eaglediff test
node ../../score.js drupal-umami --eaglediff .
```

Broken images (b05, b21), the missing web font (b20) and the server error (b26)
are reported as capture errors; the other pages are still compared and appear in
the report.

## Results

Eaglediff 0.1.0 with default settings, Chrome 157, Linux (2026-11-23):

| Check | Result |
| --- | --- |
| Clean site compared with itself, twice | 99/99 each time |
| Bugs caught | 26 of 27 |
| False alarms on the control pages | 0 |

Missed: rounded image corners (b12). They change about 80 pixels, fewer than
`thresholdMaxPixels: 500` allows.

To record `visibleAt` again, run the clean site through `calibrate` with
`thresholdRate: 0`, `thresholdRateColor: 0` and `thresholdMaxPixels: null`, add
the bugs, run `test`, and then `node ../../ground-truth.js drupal-umami <that folder>`.
