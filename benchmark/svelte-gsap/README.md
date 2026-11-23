# Svelte GSAP visual bug benchmark

A reproducible test bed for visual regression tools on a modern, animation-heavy
JavaScript site: the MIT-licensed
[svelte-gsap-template](https://github.com/YusufCeng1z/svelte-gsap-template)
(Svelte 5, SvelteKit, Tailwind CSS 4, GSAP with ScrollTrigger, Lenis smooth
scrolling), pinned to one commit. The template is a single page; [site/](site/)
adds fifteen more pages built from its sections and in its style: studio,
services, work and journal pages, a contact form and project and article pages.

The site moves a lot after it loads: an endless logo marquee, entrance
timelines, scroll-triggered reveals and counters, a testimonial rotator on a
6-second timer, a custom cursor, and an animated GIF behind the hero.

[serve.js](serve.js) serves the built site. Started with `VISUAL_BUGS=1`, it adds
12 known bugs, one per page, from [visual-bugs/](visual-bugs/); four other pages
stay unchanged as controls. See [the benchmark method](../../docs/benchmarks.md#method)
for how results are scored.

| Kind | Bugs |
| --- | --- |
| Content | typo in the footer heading, typo in the "Next project" label |
| Images | broken project cover (HTTP 404) |
| Layout and text | 2px row shift, letter spacing in service cards |
| Colour and missing | lighter article text, missing e-mail field border, missing FAQ question, missing logo in the moving marquee |
| Late content | notice bar added by JavaScript 2 seconds after load |
| Viewport | phone-only missing category, wide-screen-only extra footer space |

[bugs.json](bugs.json) lists every page, its bug and the viewports where it
changes pixels.

## Setup

Requires git and Node.js 20.19 or newer. Create the clean site in an empty
folder:

```bash
benchmark/svelte-gsap/setup.sh ~/sites/eaglediff-svelte
```

This clones the template at commit `a6648f6`, copies the pages from `site/`,
switches it to static output, installs its locked dependencies and builds it.
The fonts load from Google Fonts, so captures need internet access.

Serve the clean site at `http://localhost:4173`:

```bash
node benchmark/svelte-gsap/serve.js ~/sites/eaglediff-svelte
```

Stop it and start it with `VISUAL_BUGS=1` to add the bugs.

## Run with any tool

1. Take reference screenshots of the clean site for every page in `bugs.json`,
   at 360×640, 1024×768 and 1920×1080, full page, and compare the clean site
   with them (see "Calibrate first").
2. Restart the server with `VISUAL_BUGS=1`.
3. Compare against the references, and write each flagged page and viewport to
   a text file (`s03 phone`, or `s05 error` for a capture error).
4. Score it: `node benchmark/score.js svelte-gsap flagged.txt`

## Calibrate first

Before adding the bugs, compare the clean site with itself. It must report no
differences. A difference there is a false alarm, and it also makes the bug
score meaningless: a flagged bug page may only be showing the same noise.

Do not set the thresholds to 0 to make a tool look more sensitive. This site
shows how real sites behave: compared with itself at zero thresholds, a few
captures differ by up to about 40 pixels of anti-aliasing between runs, so a
zero-threshold calibration fails. Zero thresholds are used here only to record
where each bug changes pixels (`visibleAt`), checked against those noise levels.

## Run with Eaglediff

`setup.sh` writes `eaglediff/config.json` with
`node benchmark/make-config.js svelte-gsap`: Eaglediff's default settings plus
the site URL, viewports and pages from [bugs.json](bugs.json), nothing else. Run
it again after updating Eaglediff.

```bash
cd benchmark/svelte-gsap/eaglediff
eaglediff reference          # clean site
eaglediff calibrate          # must pass: see "Calibrate first"
# restart the server with VISUAL_BUGS=1, then:
eaglediff test
node ../../score.js svelte-gsap --eaglediff .
```

## Results

Eaglediff 0.1.0 with default settings, Chrome 157, Linux (2026-11-23):

| Check | Result |
| --- | --- |
| Clean site compared with itself, 20 times | 48/48 each time |
| Bugs caught | 11 of 12 |
| False alarms on the control pages | 0 |

Missed: the one-letter typo in the small "Next project" label (s06). It changes
about 176 pixels, fewer than `thresholdMaxPixels: 500` allows. The footer typo
(s02) is caught on tablets and wide screens but not on phones, where the heading
is smaller.

To record `visibleAt` again, run the clean site through `calibrate` with
`thresholdRate: 0`, `thresholdRateColor: 0` and `thresholdMaxPixels: null`, add
the bugs, run `test`, and then `node ../../ground-truth.js svelte-gsap <that folder>`.
