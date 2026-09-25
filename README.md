# reg-suit-runner

**reg-suit-runner (RSR)** tests websites and web apps visually, using reg-suit to compare screenshots.
It aims to be a BackstopJS alternative with more defaults built in,
so you can get started out of the box—or as close to it as possible.

## Install

Requires Node.js, pnpm, and Chrome/Chromium. From a local checkout:

```bash
pnpm install
pnpm add -g /path/to/reg-suit-runner
```

## Quick Start

### Calibrate

Create config and calibrate by comparing the same site against itself:

```bash
rsr --dir tests/reg-suit-runner config -- --limit=25 --ref=https://example.com
rsr --dir tests/reg-suit-runner reference -- --workers=15
rsr --dir tests/reg-suit-runner test -- --workers=15
rsr --dir tests/reg-suit-runner report
```

All tests should pass. If they don't, adjust `tests/reg-suit-runner/config.json`,
then rerun `reference` and `test`. For an existing config, set both base URLs to
the same site before calibrating.

### Compare environments

Once calibration passes, change `testBaseURL` to your staging or local site:

```bash
rsr --dir tests/reg-suit-runner test -- --workers=15
rsr --dir tests/reg-suit-runner report
```

## Import From Backstop

```bash
rsr --dir tests/reg-suit-runner import --backstop=/path/to/tests/backstop
```

Reads `backstop.json` and derives the base URLs from its scenarios. Review the
imported config before capturing references.

## Commands And Config

```bash
rsr --dir tests/reg-suit-runner test -- --filter=homepage --workers=15
rsr --dir tests/reg-suit-runner approve
rsr --dir tests/reg-suit-runner results
rsr --dir tests/reg-suit-runner config -- --limit=25
```

- `--dir` selects the folder containing `config.json`, screenshots in `.reg/`, and run history in `results.json`.
- `approve` accepts the latest captured screenshots by replacing the reference set with them. Review the report first.
- `results` prints pass counts, duration, and worker count for the latest two runs, plus a short history.
- `config` discovers links and merges scenarios. It preserves saved URLs, settings, and existing scenarios; `/` counts toward `--limit`.
- For new configs, omitted or empty `--test` defaults to `--ref`. Edit saved base URLs directly to change environments.
- `config` also adds `.reg/` to the project's `.gitignore`.
- `--filter` matches labels or URLs; `--workers` controls capture concurrency. `report` only opens the latest report.
- `--clean` is the default: `reference` rebuilds baselines. `--no-clean` retains cached files between runs.

## Project-Specific Adjustments

New configs include browser scripts (hooks) that prepare fonts, images, animations,
and consent dialogs for capture. See [config-default.json](config-default.json)
for available settings; edit your project's `config.json` to customize them.

In `config.json`, put shared settings in `defaults` and page-specific settings
in an entry in the `scenarios` array. Selectors below are CSS selectors:

| Setting | Purpose |
| --- | --- |
| `readySelector` | Wait for an element such as `footer`; capture fails if it doesn't appear before the timeout. |
| `hideSelectors` | Hide elements while preserving their space. |
| `removeSelectors` | Remove elements and their space, including a wrapping `li` if needed. |
| `hideDynamicSelectors` | Apply `display: none`, including to elements injected later. |
| `randomImage` / `randomContent` | Replace selected variable content with repeatable placeholders. |
| `replaceContent` | Replace matching elements' contents with text you specify. |
| `cssOverrides` | Inject custom CSS, including media queries, into both captures. |

### `randomImage` and `randomContent`

Example entry in `scenarios` (replace these selectors with ones from your site):

```json
{
  "url": "/news",
  "randomImage": [".news-card img"],
  "randomContent": [".news-card .summary"]
}
```

### `replaceContent`

For specific text, add `replaceContent` to `defaults` or a scenario in `config.json`:

```json
"replaceContent": {
  ".open-hours": "This content"
}
```

Use an object (`{}`), not an array. Every matching element keeps its own tag and
attributes, but its children are replaced with plain text, not HTML. Missing
selectors are ignored; `""` clears the content. A scenario's object replaces the
default object; `{}` disables these replacements for that scenario.

### Enable content replacements

Random and specific-text replacements require `hooks/replace-random-content` in `onReadyScript`,
after `hooks/normalize-responsive-images` and before `hooks/normalize-image-decoding`.
If both text settings match an element, `replaceContent` runs after `randomContent`.
Regenerate references after changing capture settings.

### `cssOverrides`

Apply custom CSS to both captures. Add it to `defaults` or a scenario.

Example: replace a randomized background with a fixed image above 500px:

```json
"cssOverrides": "@media (min-width: 500px) { body { background-image: url('/sites/default/files/styles/large_screens_s/public/2017-11/_MG_3558_WEB.jpg') !important; } }"
```

Older configs need `hooks/apply-css-overrides` after `hooks/replace-random-content`
in `onReadyScript`. Regenerate references after changing the CSS.

### Comparison settings

In your project's `config.json`, the `core` object controls how screenshots are compared:

```json
"core": {
  "thresholdRate": 0.001,
  "thresholdRateColor": 0.05
}
```

- `thresholdRate: 0.001` allows 0.1% of an image's pixels to differ before the comparison fails.
- `thresholdRateColor: 0.05` ignores small colour differences when deciding whether a pixel differs. Its scale is 0–1; `0` is strictest, and higher values ignore larger colour differences. It is not a percentage of pixels.

Keep other existing `core` settings when editing these values.
