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
- `--filter` matches labels or URLs; `--workers` overrides `core.workers` (default `10` in new or updated configs). Each scenario/viewport pair can run in a separate worker (one scenario with three viewports uses up to three workers). `report` only opens the latest report.
- `--clean` is the default: `reference` rebuilds baselines. `--no-clean` retains cached files between runs.

## Update An Existing Config

After updating RSR:

```bash
rsr --dir tests/reg-suit-runner config-update
```

Adds missing settings (including nested defaults) and default hooks from
`config-default.json`. Preserves saved values, URLs, scenarios, viewports, and
existing hook order. Missing hooks are inserted beside their default neighbours;
this also restores default hooks you previously removed. Other existing arrays
are kept unchanged. Recalibrate after updating.

`version` records the runner/config revision, starting at `2026.09.26.01`
(`YYYY.MM.DD.NN`). Bump it in `config-default.json` when runner or config changes need a new revision;
`NN` increments for changes on the same date. The command updates this field
and refuses to downgrade a config from a newer revision.

## Capture Errors

Capture errors report the scenario, viewport, attempted page URL, and failing
hook. Redirected pages also include the final URL. Image errors include the image
URL, processing step, and Chrome's network error when available.

## Default Hooks

New configs include this `onReadyScript` list. Use `config-update` to add missing
hooks to an older config, or copy the list below.
Hooks run in the order shown.

```json
"onReadyScript": [
  "hooks/wait-for-browser-verification",
  "hooks/fail-on-response-status",
  "hooks/wait-for-element",
  "hooks/wait-until-gone",
  "hooks/scroll-to-bottom",
  "hooks/wait-for-stable-content",
  "hooks/hide-dynamic-elements",
  "hooks/disable-animations",
  "hooks/wait-for-fonts",
  "hooks/pause-media",
  "hooks/load-lazy-images",
  "hooks/normalize-responsive-images",
  "hooks/replace-random-content",
  "hooks/apply-css-overrides",
  "hooks/normalize-image-decoding",
  "hooks/keep-selectors",
  "hooks/wait-for-background-images",
  "hooks/wait-for-network-idle",
  "hooks/stabilize-carousels"
]
```

## Project-Specific Adjustments

Edit your project's `config.json`. Default values are in
[config-default.json](config-default.json); examples below cover project-specific values.
All durations are milliseconds. Hook names below have the prefix `hooks/` and
must appear in `onReadyScript`; use the [default list](#default-hooks) for ordering.
`-` means no hook is needed for that parameter.

### Familiar to Backstop users

These share names or concepts with [Backstop settings](https://github.com/garris/BackstopJS#scenario-properties).
The descriptions show how RSR uses them.

| Setting | Where | Purpose | Hook |
| --- | --- | --- | --- |
| `viewports` | Root | Screen sizes: each entry has `label`, `width`, `height`, and optional `deviceScaleFactor` (1 by default). | - |
| `scenarios` | Root | Pages to capture; each entry has a `url` and optional `label`. | - |
| `url` / `label` | Scenario | Page path or absolute URL, and display name. Paths use the selected environment's base URL. | - |
| `defaults` | Root | Container for shared capture settings, like Backstop's `scenarioDefaults`. Each setting's hook is listed in its own row. | - |
| `onBeforeScript` / `onReadyScript` | Root or scenario | Script lists run before navigation or after navigation and `delay`. Scenario scripts run after the root list. | Listed scripts |
| `delay` | Defaults or scenario | Pause after navigation, before ready hooks run. | - |
| `readySelector` | Defaults or scenario | Wait for a matching element; fail if it never appears. | `wait-for-element` |
| `readyTimeout` | Defaults or scenario | Maximum wait for `readySelector`. | `wait-for-element` |
| `hideSelectors` | Defaults or scenario | Hide matching elements, keeping their space. | - |
| `removeSelectors` | Defaults or scenario | Remove matching elements and their space from the DOM. | - |
| `fullPage` | Defaults or scenario | Capture the whole page; `false` captures the viewport. | - |
| `waitUntil` | Defaults only | Navigation readiness: `domcontentloaded`, `load`, `networkidle0`, or `networkidle2`. | - |
| `keepSelectors` | Defaults or scenario | Similar to Backstop's `selectors`, but produces one crop enclosing all matches. Missing selectors fail capture. | `keep-selectors` |
| `core.thresholdRate` | Root | Allowed fraction of changed pixels. `0.001` means 0.1%; Backstop's `misMatchThreshold` uses percentages instead. | - |

### RSR-specific settings

Unless marked **Root** or **Scenario only**, put these in `defaults` or a scenario.
Nested names such as `browserVerification.timeout` belong inside that object's JSON.

| Setting | Purpose | Hook |
| --- | --- | --- |
| `referenceBaseURL` / `testBaseURL` | **Root:** base URLs for reference and test captures. | - |
| `core.thresholdRateColor` | **Root:** colour tolerance when counting changed pixels, from 0–1. `0` is strictest; higher values ignore larger colour differences. This is not a percentage of pixels. | - |
| `core.temporaryErrorRetries` | **Root:** retries per capture for temporary network or browser errors. | - |
| `core.workers` | **Root:** maximum concurrent captures; `--workers` overrides it. Older configs without this setting use one worker. | - |
| `core.protocolTimeout` | **Root:** timeout for browser protocol commands. | - |
| `readyVisible` | Require the ready element to be visible as well as present. | `wait-for-element` |
| `failOnResponseStatusCodes` | Main-page HTTP status codes that fail capture. | `fail-on-response-status` |
| `browserVerification.challengeSelectors` | Detect a browser-verification page; wait for these markers to disappear. | `wait-for-browser-verification` |
| `browserVerification.errorSelectors` | Visible error markers that fail capture during verification. | `wait-for-browser-verification` |
| `browserVerification.timeout` | Maximum wait for verification to finish. | `wait-for-browser-verification` |
| `waitForStableContent.triggerSelectors` | Only wait when at least one trigger exists. With no triggers, a target must already exist. | `wait-for-stable-content` |
| `waitForStableContent.selectors` | Elements to watch for stable dimensions, child count, and text length. | `wait-for-stable-content` |
| `waitForStableContent.timeout` | Maximum wait for targets to appear and for content to settle, per wait stage. | `wait-for-stable-content` |
| `waitForStableContent.settleDelayMs` | How long the watched measurements must remain unchanged. | `wait-for-stable-content` |
| `waitUntilGone` | Wait for all matches to disappear or become hidden. | `wait-until-gone` |
| `waitUntilGoneTimeout` | Maximum wait per selector. | `wait-until-gone` |
| `scrollStepDelayMs` / `scrollSettleDelayMs` | Pause between scroll steps and after returning to the top; defaults are 100 and 300. | `scroll-to-bottom` |
| `carouselSelectors` | Pause supported carousels and return them to the first slide. | `stabilize-carousels` |
| `carouselSettleDelayMs` | Pause after resetting carousels. | `stabilize-carousels` |
| `hideDynamicSelectors` | Apply `display: none`, including to elements added later. | `hide-dynamic-elements` |
| `keepCookiebot` | **Scenario only:** skip the entire `hideDynamicSelectors` hook for this page. | `hide-dynamic-elements` |
| `normalizeResponsiveImageSelectors` | Freeze image/source choices and remove responsive sizing attributes. | `normalize-responsive-images` |
| `normalizeImageDecodingSelectors` | Convert selected JPEGs to PNGs for capture. If fetching is blocked but the original image loads, keep it and warn. Broken images still fail. | `normalize-image-decoding` |
| `randomImage` | Replace selected images with fixed placeholders; use a background placeholder when the target contains no images. | `replace-random-content` |
| `randomContent` | Replace selected elements' children with placeholder text. | `replace-random-content` |
| `replaceContent` | Map selectors to specific replacement text. | `replace-random-content` |
| `cssOverrides` | Apply custom CSS to both reference and test captures. | `apply-css-overrides` |
| `networkIdleTime` / `networkIdleTimeout` | Required network quiet time and maximum wait. Timing out here does not fail capture. | `wait-for-network-idle` |
| `addParagraph` | **Scenario only:** enable a deliberate visual change during `test -- --addpara`. | `add-paragraph` (called automatically) |
| `addParagraphTarget` | **Scenario only:** element to append the test paragraph to; defaults to `main`, falling back to `body`. | `add-paragraph` |
| `addParagraphText` / `addParagraphSelector` | **Scenario only:** injected text and wrapper ID; defaults are `Reg-suit injected paragraph` and `#reg-suit-paragraph`. | `add-paragraph` |

Scenario values generally replace defaults. `hideSelectors` and `removeSelectors`
are added to the default lists; `browserVerification` and `waitForStableContent`
merge their fields. Parallel captures raise the default `readyTimeout` and
`waitUntilGoneTimeout` to at least 30000; explicit scenario timeouts still apply.

Compatibility fields: scenario `referenceUrl` is a fallback when `url` is missing,
not a separate reference destination. Use the base URLs for environment changes.
Root `readySelector`, `readyTimeout`, and `failOnResponseStatusCodes` are also
accepted as fallbacks. Older `waitForTriggerSelectors`, `waitForSelectors`,
`waitForTimeout`, and `waitForSettleDelayMs` map to the corresponding
`waitForStableContent` fields when those nested fields are absent.

### `waitUntilGone`, `carouselSelectors`, and `keepSelectors`

Example scenario: wait for a loader, reset a carousel, then capture the main area.

```json
{
  "url": "/gallery",
  "waitUntilGone": [".loading-overlay"],
  "carouselSelectors": [".gallery.swiper"],
  "keepSelectors": ["main"]
}
```

Use your site's selectors. These three settings are disabled by empty lists in new configs.

### `randomImage` and `randomContent`

Example scenario:

```json
{
  "url": "/news",
  "randomImage": [".news-card img"],
  "randomContent": [".news-card .summary"]
}
```

For varying image sizes, an image entry can be
`{ "selector": ".banner img", "width": 1200, "height": 675 }`.
Both dimensions are required together; they set the placeholder's intrinsic size.
A text entry can use `{ "selector": ".summary", "text": "Fixed summary" }`.

### `replaceContent`

Add to `defaults` or a scenario:

```json
"replaceContent": {
  ".open-hours": "This content"
}
```

Replaces children with plain text, keeping the matched element and its attributes.
Missing matches are ignored; `""` clears content. A scenario's `{}` disables
inherited replacements. When both match, `replaceContent` runs after `randomContent`.

### `cssOverrides`

Add to `defaults` or a scenario. Example: fix a randomized background at 500px and wider:

```json
"cssOverrides": "@media (min-width: 500px) { body { background-image: url('/images/fixed-background.jpg') !important; } }"
```

Use an image path available on your site. A scenario's CSS replaces the default
CSS; `""` disables it for that scenario.

### `addParagraph`

Example scenario for checking that a deliberate change is detected:

```json
{
  "url": "/about",
  "addParagraph": true,
  "addParagraphTarget": ".page-content"
}
```

Run `rsr --dir tests/reg-suit-runner test -- --filter=about --addpara`.

After changing capture settings, regenerate references before running `test`.
Existing configs need the corresponding hooks from [Default Hooks](#default-hooks).
