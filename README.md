# Eaglediff

**Eaglediff** is a visual regression testing (VRT) tool that captures web pages
and other browser-rendered content, using [reg-suit](https://github.com/reg-viz/reg-suit)
as its comparison engine to detect visual changes between screenshots.
It aims to be a BackstopJS alternative with more defaults built in.

## Install

Requires Git, Node.js **22.12.0 or newer** (recommended: **22.19.0**, see `.nvmrc`),
pnpm **9.0.0 or newer**, and Chrome/Chromium. See [Prerequisites](#prerequisites)
for installation and verification instructions.

Clone the repository first, then install from inside its folder:

```bash
# Download Eaglediff (requires GitLab SSH access)
git clone git@gitlab.com:n3tt/eaglediff.git
cd eaglediff

# Install dependencies
pnpm install

# Install the eaglediff command globally from this folder
pnpm add -g "$PWD"
```

`$PWD` means the current folder. The global
installation lets you run `eaglediff` from anywhere.

## Quick Start

### Calibrate

From your project's test folder, compare the site against itself first:

```bash
cd tests/eaglediff

# Find up to 25 pages and create config.json
eaglediff config --ref=https://example.com

# Save the reference screenshots
eaglediff reference

# Take new screenshots and compare them with the references
eaglediff test

# Open the comparison report
eaglediff report
```

All tests should pass. If they don't, adjust `config.json` settings,
then rerun `reference` and `test`. For an existing config, set both base URLs to
the same site before calibrating.

### Compare environments

Once calibration passes, change `testBaseURL` to your staging or local site:

```bash
# Compare the changed environment with your references
eaglediff test

# Open the report to review the differences
eaglediff report
```

## Eaglediff and BackstopJS

Eaglediff is a new project. The strengths below are early claims based on its
implementation and maintainer-reported results; broader testing by the community
is needed to validate them across websites, machines, and workloads. Your reports on this matters would be appreciated.

| Area | Eaglediff's intended strength |
| --- | --- |
| Stability | Font/image readiness, adaptive retries, and browser recovery aim to keep captures consistent under slow networks or busy CPUs. |
| Modular defaults | Configurable hooks for lazy images, fonts, animations, backgrounds, and dynamic content. |
| Comparison engine | Independently maintained reg-suit handles screenshot comparison and reports. |
| Setup | Automatic page discovery and Backstop configuration import reduce setup work. |
| Config maintenance | New defaults can be added while preserving saved customization. |
| Baselines | URL and label distinguish scenarios; filtered updates preserve unrelated references. |
| Diagnostics | Page, hook, resource, and navigation details help explain capture failures. |
| Challenge detection | Stops captures when known CDN or bot-protection challenges are detected, avoiding verification pages as reference screenshots. |
| Concise output | Short progress updates and clear summaries keep runs easy to follow. |
| Automation | End-of-run summaries, dated structured results, and meaningful exit codes help CI jobs track outcomes and highlight visual changes. |

## AI-assisted development

Parts of Eaglediff's code, tests, and documentation were developed with
assistance from AI coding tools, including OpenAI Codex. Maintainers direct the
project and remain responsible for technical decisions, reviewing contributions,
and validating behavior. AI-assisted contributions are subject to the same
review and testing standards as other contributions.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `EAGLEDIFF_DIR`, `EAGLEDIFF_PROJECT_DIR`, `EAGLEDIFF_ROOT` | Project directory for scripts. Prefer the CLI's `--dir` option. |
| `EAGLEDIFF_CONFIG`, `GLOBAL_EAGLEDIFF_CONFIG` | Override the config file path. |
| `EAGLEDIFF_SCRIPT_DIR`, `EAGLEDIFF_HELPER_DIR` | Runner checkout containing scripts and defaults. Prefer `--script-dir`. |
| `EAGLEDIFF_INVOCATION_DIR` | Original working directory passed by the CLI to resolve import paths. |

## Import From Backstop

```bash
eaglediff import --backstop=/path/to/tests/backstop
```

Reads `backstop.json` and derives the base URLs from its scenarios. Review the
imported config before capturing references. Backstop `cookiePath` entries are
imported as paths relative to the Eaglediff config, resolving the source paths relative
to `backstop.json`. A shared file becomes `defaults.cookiePath`; different files
remain on their scenarios. Custom Backstop scripts are not executed by Eaglediff.
Backstop's `asyncCaptureLimit` becomes `core.workers` unless the existing Eaglediff
config already specifies workers, avoiding an increase in capture concurrency
on import.

Import reports repeated URLs and keeps each scenario when its label is distinct:

```json
[
  { "url": "/courses", "label": "Courses" },
  { "url": "/courses", "label": "Expanded courses" }
]
```

If both URL and label repeat, import adds unique IDs to those scenarios and
shows them in the warning. Otherwise, no extra ID is added. Re-importing rebuilds
the scenario list, so back up manual scenario edits first.

Screenshot filenames now include the label in their identity. Existing labeled
scenarios need fresh references after upgrading; renaming a label also changes
its screenshot filename. Unlabeled scenarios without IDs keep their existing filenames.
For scenarios with an `id`, keep it unchanged to preserve its screenshot filename.

For existing imports, add `defaults.cookiePath` manually to preserve calibration
changes rather than replacing scenarios with another import. Cookie files contain
an array of cookie objects with `name`, `value`, and optional `domain`, `path`,
`expires` (Unix seconds), `secure`, `httpOnly`, and `sameSite`.
For reusable consent fixtures that should apply to both environments:

```json
{
  "defaults": {
    "cookiePath": "../backstop/backstop_data/engine_scripts/cookies.json",
    "cookieDomain": "current",
    "cookieExpiry": "session"
  }
}
```

These options explicitly change the domain and expiry; without them, Eaglediff
preserves both. Cookie values are never logged. File cookies are applied first,
followed by inline `cookies`, which can override cookies with the same scope.

If `reference` fails during navigation, its error includes `waitUntil`, the
navigation timeout, elapsed time, main-document HTTP responses and redirects,
DOMContentLoaded/load events, and a bounded list of pending and failed requests.
Diagnostic request URLs omit query strings, fragments and credentials. The run
stops and cancels remaining workers on the first failed capture; progress lines
indicate captures starting, not captures successfully saved. A failed `reference`
also prevents `test` from running when connected with `&&`.
To isolate a failing page:

```bash
eaglediff reference --filter=Inspire --workers=1
```

For slow pages, increase `defaults.navigationTimeout` (for example to `60000`)
or set `navigationTimeout` on the affected scenario. `core.protocolTimeout`
controls browser protocol commands and does not increase the navigation timeout.

## Commands And Config

```bash
# Test matching pages with up to 15 workers
eaglediff test --filter=homepage --workers=15
eaglediff approve
eaglediff results
eaglediff config
```

- `--dir` selects the folder containing `config.json`, screenshots in `.reg/`, and run history in `results.json`.
- `test` exits with code `1` for changed, new, or deleted screenshots; passing comparisons exit `0`. Reports and history are saved before returning the exit status.
- `approve` accepts the latest completed comparison. Filtered comparisons update only their captured baselines; full comparisons replace the full reference set. `approve --filter=...` narrows approval further. Review the report first. Missing or invalid source screenshots prevent approval.
- `results` prints pass counts, duration, and worker count for the latest two runs, plus a short history.
- `config` discovers links and merges scenarios. It preserves saved URLs, settings, and existing scenarios except those matching `excludeExtensions`; `/` counts toward `--limit`.
- For new configs, omitted or empty `--test` defaults to `--ref`. Edit saved base URLs directly to change environments.
- `config` also adds `.reg/` to the project's `.gitignore`.
- `--filter` matches labels, IDs, or URLs; `--workers` overrides `core.workers`. When neither is set, Eaglediff uses `core.workers` from `config-default.json` (currently `10`). Each scenario/viewport pair can run in a separate worker (one scenario with three viewports uses up to three workers). `report` only opens the latest report.
- `--clean` is the default: full `reference` runs rebuild baselines. Filtered reference runs replace only matching baselines. `--no-clean` retains cached files between runs.

Set the root-level `excludeExtensions` array in `config.json` to skip file links
during discovery, for example `"excludeExtensions": [".pdf", ".zip", "docx"]`.
The default in `config-default.json` is `[".pdf"]`. Extensions accept an optional
leading dot and match case-insensitively against the URL path, ignoring queries
and fragments. Use `[]` to allow all extensions. Running `config` uses the saved
list and also removes matching existing scenarios; excluded links do not count
toward `--limit`. `config-update` adds the setting when missing and preserves
custom lists. Run `config` afterward to filter existing scenarios.

## Capture environment

Comparing a live site with a DDEV-hosted site does not require both sites to run
in Docker. Rendering consistency depends on the capture browser's OS, Chrome
version, fonts, and display settings. Hosting a site in DDEV does not standardize
that browser environment. When sharing baselines across machines or CI, use a
consistent browser environment, such as the same container image for captures.

## Update An Existing Config

After updating Eaglediff:

```bash
eaglediff config-update
```

Adds missing settings (including nested defaults) and default hooks from
`config-default.json`. Preserves saved values, URLs, scenarios, viewports, and
existing hook order. Missing hooks are inserted beside their default neighbours;
this also restores default hooks you previously removed. Other existing arrays
are kept unchanged. Recalibrate after updating.

New configs leave `readySelector` empty. Updating an existing config keeps its
saved selector, including the old footer selector. To stop waiting for it, set
`defaults.readySelector` to `""` (and clear root `readySelector` if present).

`version` records the runner/config revision, starting at `2026.09.26.01`
(`YYYY.MM.DD.NN`). Bump it in `config-default.json` when runner or config changes need a new revision;
`NN` increments for changes on the same date. The command updates this field
and refuses to downgrade a config from a newer revision.

Before running a command, Eaglediff compares the config version with its bundled defaults.
Newer configs require confirmation; older or unversioned configs offer an update.
Declining the update keeps your config and continues. In non-interactive runs,
older configs continue with a warning; newer configs stop unless you pass
`--allow-newer-config`. Use `config-update` to update explicitly.

## Capture Errors

Capture errors report the scenario, viewport, attempted page URL, and failing
hook. Redirected pages also include the final URL. Image errors include the image
URL, processing step, and Chrome's network error when available.

Full-page and clipped captures include a preliminary rendering pass to reduce
missing offscreen content in Chrome. Only the final screenshot is saved; viewport
dimensions and comparison thresholds stay unchanged.

## Default Hooks

New configs also run `hide-dynamic-elements`, `disable-animations`, and
`apply-css-overrides` in `onBeforeScript`. Their CSS applies as the document is
created, before page scripts, and covers elements inserted later. The ready hooks
reapply the styles before capture. `config-update` adds these hooks to existing configs.

New configs include this `onReadyScript` list. Use `config-update` to add missing
hooks to an older config, or copy the list below.
Hooks run in the order shown.
The bundled `keep-selectors` hook is deferred until after final DOM edits and
font readiness, so clipping uses the final layout.

```json
"onReadyScript": [
  "hooks/wait-for-browser-verification",
  "hooks/fail-on-response-status",
  "hooks/wait-for-element",
  "hooks/wait-until-gone",
  "hooks/scroll-to-bottom",
  "hooks/hide-dynamic-elements",
  "hooks/disable-animations",
  "hooks/wait-for-fonts",
  "hooks/pause-media",
  "hooks/load-lazy-images",
  "hooks/normalize-responsive-images",
  "hooks/replace-random-content",
  "hooks/apply-css-overrides",
  "hooks/normalize-image-decoding",
  "hooks/wait-for-stable-content",
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
The descriptions show how Eaglediff uses them.

| Setting | Where | Purpose | Hook |
| --- | --- | --- | --- |
| `viewports` | Root | Screen sizes: each entry has `label`, `width`, `height`, and optional `deviceScaleFactor` (1 by default). | - |
| `scenarios` | Root | Pages to capture; each entry has a `url` and optional `label`. | - |
| `url` / `label` | Scenario | Page path or absolute URL, and display name. Paths use the selected environment's base URL. | - |
| `id` | Scenario | Optional extra name to distinguish scenarios with the same URL and label. Import adds it only when needed. | - |
| `defaults` | Root | Container for shared capture settings, like Backstop's `scenarioDefaults`. Each setting's hook is listed in its own row. | - |
| `onBeforeScript` / `onReadyScript` | Root or scenario | Script lists run before navigation or after navigation and `delay`. Scenario scripts run after the root list. | Listed scripts |
| `delay` | Defaults or scenario | Pause after navigation, before ready hooks run. | - |
| `readySelector` | Defaults or scenario | Optional element to wait for; empty by default. A missing required element fails capture. | `wait-for-element` |
| `readyTimeout` | Defaults or scenario | Maximum wait for `readySelector`. | `wait-for-element` |
| `hideSelectors` | Defaults or scenario | Hide matching elements, keeping their space. | - |
| `removeSelectors` | Defaults or scenario | Remove matching elements and their space from the DOM. | - |
| `fullPage` | Defaults or scenario | Capture the whole page; `false` captures the viewport. | - |
| `waitUntil` | Defaults or scenario | Navigation readiness: `domcontentloaded`, `load`, `networkidle0`, or `networkidle2`. | - |
| `navigationTimeout` | Defaults or scenario | Navigation timeout, default `30000`. Separate from `core.protocolTimeout`; `0` disables the timeout. | - |
| `cookiePath` / `cookies` | Defaults or scenario | JSON cookie file relative to `config.json`, plus optional inline cookie array. Applied before navigation in an isolated browser context for each capture. Set `cookiePath: null` and `cookies: []` on a scenario to disable shared cookies. | - |
| `keepSelectors` | Defaults or scenario | Similar to Backstop's `selectors`, but produces one crop enclosing all matches. Missing selectors fail capture. | `keep-selectors` |
| `core.thresholdRate` | Root | Allowed fraction of changed pixels. `0.001` means 0.1%; Backstop's `misMatchThreshold` uses percentages instead. | - |

### Eaglediff-specific settings

Unless marked **Root** or **Scenario only**, put these in `defaults` or a scenario.
Nested names such as `browserVerification.timeout` belong inside that object's JSON.

| Setting | Purpose | Hook |
| --- | --- | --- |
| `referenceBaseURL` / `testBaseURL` | **Root:** base URLs for reference and test captures. | - |
| `core.thresholdRateColor` | **Root:** colour tolerance when counting changed pixels, from 0–1. `0` is strictest; higher values ignore larger colour differences. This is not a percentage of pixels. | - |
| `core.temporaryErrorRetries` | **Root:** retries per capture for temporary network/browser errors, navigation timeouts, image-loading timeouts, font failures, and readySelector timeouts. Each retry starts in a fresh browser context. Broken images and page HTTP errors still fail. Default `0` disables retries. | - |
| `core.temporaryErrorRetryTimeoutMultiplier` | **Root:** multiply configured readiness timeouts on each retry. Default `1` keeps them unchanged; `2` gives attempts budgets of 1×, 2×, and 4×. Workers, delays, retry count and protocolTimeout stay unchanged. | - |
| `fontTimeout` | Maximum wait for web fonts, default `30000` milliseconds. Font timeouts and failed font downloads fail capture and use temporary retries. | `wait-for-fonts` |
| `retryImageDownloads` | Retry stalled HTTP image downloads on the existing page through Node, then require successful browser decoding. Default `false`. Cookies are scoped to each destination, including redirects. | `load-lazy-images` |
| `imageDownloadTimeout` | Maximum time for each recovery download and its subsequent browser decoding, default `15000` milliseconds. | `load-lazy-images` |
| `requiredFonts` | CSS font specifications that must resolve to declared web fonts, for example `["400 16px Inter", "700 16px Quicksand"]`. Default `[]` still checks fonts the page requested. Scenario values replace defaults. | `wait-for-fonts` |
| `core.workers` | **Root:** maximum concurrent captures; `--workers` overrides it. Configs without this setting use `core.workers` from `config-default.json` (currently `10`). | - |
| `core.protocolTimeout` | **Root:** timeout for browser protocol commands. | - |
| `cookieDomain` | `null` preserves cookie domains (missing domains use the capture hostname). `"current"` explicitly scopes cookies to the current reference/test hostname; a domain string sets a fixed domain. | - |
| `cookieExpiry` | `null` preserves expiry and warns when expired cookies are skipped. `"session"` removes expiry for reusable test fixtures. | - |
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
| `carouselSelectors` | Pause supported carousels and return them to the first slide. `null` detects known libraries; `[]` disables it. | `stabilize-carousels` |
| `carouselSettleDelayMs` | Pause after resetting carousels. | `stabilize-carousels` |
| `hideDynamicSelectors` | Apply `display: none`, including to elements added later. | `hide-dynamic-elements` |
| `keepCookiebot` | **Scenario only:** skip the entire `hideDynamicSelectors` hook for this page. | `hide-dynamic-elements` |
| `lazyImageTimeout` | Maximum wait in milliseconds for each image to decode after lazy loading. | `load-lazy-images` |
| `normalizeResponsiveImageSelectors` | Freeze image/source choices and remove responsive sizing attributes. | `normalize-responsive-images` |
| `normalizeImageDecodingSelectors` | Convert selected JPEGs and GIFs to PNGs for capture; GIFs use their first frame. If fetching is blocked but the original image loads, keep it and warn. Broken images still fail. | `normalize-image-decoding` |
| `randomImage` | Replace selected images with fixed placeholders; use a background placeholder when the target contains no images. | `replace-random-content` |
| `randomContent` | Replace selected elements' children with placeholder text. | `replace-random-content` |
| `replaceContent` | Map selectors to specific replacement text. | `replace-random-content` |
| `cssOverrides` | Apply custom CSS to both reference and test captures. | `apply-css-overrides` |
| `networkIdleTime` / `networkIdleTimeout` | Required network quiet time and maximum wait. Timing out here does not fail capture. | `wait-for-network-idle` |
| `addParagraph` | **Scenario only:** enable a deliberate visual change during `test --addpara`. | `add-paragraph` (called automatically) |
| `addParagraphTarget` | **Scenario only:** element to append the test paragraph to; defaults to `main`, falling back to `body`. | `add-paragraph` |
| `addParagraphText` / `addParagraphSelector` | **Scenario only:** injected text and wrapper ID; defaults are `Eaglediff injected paragraph` and `#eaglediff-paragraph`. | `add-paragraph` |

Scenario values generally replace defaults. `hideSelectors` and `removeSelectors`
are added to the default lists; `browserVerification` and `waitForStableContent`
merge their fields. Parallel captures raise the default `readyTimeout` and
`waitUntilGoneTimeout` to at least 30000; explicit scenario timeouts still apply.

Scenario `referenceUrl` overrides the reference capture path; `url` selects the
test capture path and provides the comparison identity. Relative paths use their
respective base URLs. Absolute URLs are also supported.
Root `readySelector`, `readyTimeout`, and `failOnResponseStatusCodes` are also
accepted as fallbacks. A scenario's `readySelector: ""` disables the selector
wait for that page. Otherwise, a blank default still allows a root selector.
Older `waitForTriggerSelectors`, `waitForSelectors`,
`waitForTimeout`, and `waitForSettleDelayMs` map to the corresponding
`waitForStableContent` fields when those nested fields are absent.

### Automatic carousel detection

With `"carouselSelectors": null` (the new default), Eaglediff looks for Swiper,
Slick, Owl Carousel, Bootstrap Carousel, Fotorama, Flickity, FlexSlider, and
Unite Gallery. It checks for a supported instance or controls, pauses playback,
and selects the first slide. It then checks images introduced by that change.
Class names alone do not initialize a carousel. Custom galleries and library
versions with different APIs may need a project hook.

Use an explicit selector list to restrict detection, or `[]` to turn it off.
Config updates preserve existing `[]` settings; change them to `null` to enable
automatic detection. `carouselSettleDelayMs` controls the wait after resetting
slides (default 500 ms).

The image-decoding hook also freezes GIF `<img>` elements at their first frame.
It does not freeze CSS background GIFs or images inside iframes. Cross-origin
images need CORS permission to be converted; otherwise Eaglediff keeps a working
original and warns that it may still animate. Set
`"normalizeImageDecodingSelectors": []` to disable conversion.

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

### Google Maps and other third-party embeds

Example: exclude a changing Google Maps embed during calibration. Add to your
existing `hideSelectors` in `defaults` or a scenario:

```json
"hideSelectors": [
  "iframe[src^=\"https://www.google.com/maps/embed\"]"
]
```

The map becomes blank, keeping its layout space. This uses built-in capture
handling; no extra hook is needed. Adjust the selector for your embed URL.
Use this when testing the surrounding page, since map content is no longer compared.
Avoid `removeSelectors` here: removing the iframe shifts the content below it.

For a changing reCAPTCHA badge, also add `.grecaptcha-badge`. Regenerate references
and rerun `test` after adding these settings. Eaglediff leaves embeds visible by default.

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

For a randomized CAPTCHA, a project can keep its layout stable with
`fieldset.captcha { visibility: hidden !important; height: 160px !important; overflow: hidden !important; }`.
This excludes the challenge from visual comparison. Choose the height for the site;
Eaglediff does not hide CAPTCHAs by default. For asynchronous newsletter forms, set
`readySelector` to the rendered submit button and `readyVisible` to `true`, with
a suitable `readyTimeout`, so missing forms fail capture instead of producing a misleading screenshot.
The other readiness hooks still run when `readySelector` is empty, but cannot
know which application-specific content should appear later.
If the form loads only when it enters the viewport, place `wait-for-element`
after `scroll-to-bottom` in the project's `onReadyScript` list.
Scrolling follows changes in page height as lazy content loads. `scrollTimeout`
(defaults or scenario, default `30000` milliseconds) bounds this step, including
pages that prevent scrolling. These timeouts also use `core.temporaryErrorRetries`.

### Web fonts

The `wait-for-fonts` hook waits for layout and checks for failed font faces;
the browser's `document.fonts.ready` promise also resolves when a font download
fails. Configure `requiredFonts` to catch a missing font stylesheet as well as
failed font files. Eaglediff repeats this hook after final DOM edits, just before
capture, so late text does not silently use a fallback font. Set `fontTimeout`
for slow loading and `core.temporaryErrorRetries` to retry in a fresh browser
context. These checks keep the configured worker count unchanged.

For sustained CPU or network load, set `core.temporaryErrorRetryTimeoutMultiplier`
to `2` so a retry has longer navigation, ready-element, font, image, scroll and
content-readiness budgets. Scenario timeout overrides scale as well; zero
navigation timeouts remain disabled. Choose `core.protocolTimeout` above the
longest resulting readiness budget so a browser-command timeout does not cut
the wait short. This increases the maximum time spent on failed captures; it
does not skip readiness checks or accept incomplete screenshots.

### Lazy images

The `load-lazy-images` hook loads common `data-src`, `data-srcset`, and `data-sizes`
attributes (including `data-lazy-*`) and waits for images to decode before
responsive-image normalization. Broken or timed-out images report their URL.
Hidden empty `data:,` placeholders, such as Cookiebot branding images, are
ignored when they have no real image candidate. Lazy replacement sources are
loaded first. Visible empty images and real broken images still fail capture.
`imageFailurePolicy` (defaults or scenario) defaults to `"error"`. Set `"warn"`
to continue capturing with broken images, as Backstop's stabilizer does.
Warnings identify the resources; broken placeholders remain in the screenshot
and can fail visual comparison. Optional JPEG normalization skips those failed
sources. This setting does not permit an HTTP error for the page itself.
Image-loading timeouts fail capture in both modes and use
`core.temporaryErrorRetries`: an image that is still loading can change the
layout after the screenshot. On a busy computer, reduce `core.workers` or run
with `--workers=1` to reduce competing browser work before increasing timeouts.

Set `retryImageDownloads: true` to actively recover an image after its browser
download times out. Eaglediff downloads the same resource through Node using the
current browser context's cookies, serves those bytes at the original URL, and
requires the image to decode before capture. This keeps completed readiness
steps and JPEG normalization intact. Failed downloads or decoding still fail
capture; warning mode does not accept a stalled image. Recovery reports the
page without logging cookies or URL query parameters.
Place image loading before a readiness selector that depends on the page's
load event, so a stalled image cannot block its own recovery step.

If Chromium disconnects, Eaglediff restarts the affected worker's browser on a
temporary-error retry and retains the replacement for its remaining captures.
Context and page creation failures use the same retry limit as readiness
failures. Cancelling the run prevents workers from restarting browsers.

CSS background loading checks every URL layer using `lazyImageTimeout` and
`imageFailurePolicy`. Stalled downloads fail even in warning mode and participate
in capture retries. Responsive normalization pins the loaded picture candidate
and requires successful decoding before capture.

### Scroll reveals, fading icons, and moving decorations

`disable-animations` removes CSS animation delays, but JavaScript can still hide
an element or fade it in. Use `cssOverrides` to show selected content and stop
selected decorations. Example selectors from a site using WOW and lazy images:

```json
"cssOverrides": ".wow { visibility: visible !important; opacity: 1 !important; transform: none !important; animation: none !important; } .shapes { animation: none !important; } img.lazy-img { opacity: 1 !important; }",
"waitForStableContent": {
  "triggerSelectors": [],
  "selectors": ["img.lazy-img", ".wow", ".shapes"],
  "timeout": 15000,
  "settleDelayMs": 1000
}
```

### `addParagraph`

Example scenario for checking that a deliberate change is detected:

```json
{
  "url": "/about",
  "addParagraph": true,
  "addParagraphTarget": ".page-content"
}
```

Run `eaglediff test --filter=about --addpara`.

After changing capture settings, regenerate references before running `test`.
Existing configs need the corresponding hooks from [Default Hooks](#default-hooks).

## Contributing

AI coding assistants must follow [AGENTS.md](AGENTS.md), including regression
testing and human confirmation before committing changes.

Complete [Prerequisites](#prerequisites), then activate the version in `.nvmrc`
and run these commands from the Eaglediff checkout:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm run test:unit
```

The automated suite uses Node's built-in test runner with at most four test
files running concurrently. This limits competing fixture browsers and does
not change the configured worker count for project captures. Browser integration tests
serve local fixtures and use temporary directories; a production website or
project config is not required. If Chrome is not found automatically, set
`CHROME_BIN` or `PUPPETEER_EXECUTABLE_PATH` to its executable path.

Run one test file while developing, then run the full suite before submitting:

```sh
node --test tests/lazy-images.test.js
pnpm run test:coverage
```

`pnpm test` runs the visual comparison command for a configured project.
Use `pnpm run test:unit` to test Eaglediff itself.

For fixes, add a regression test that demonstrates the incorrect behavior and
checks the resulting screenshot, comparison report, exit code, or saved files.
Hook changes should cover scenario overrides, failure handling, and interactions
with later hooks. Keep fixtures local and deterministic; clean up browsers,
servers, and temporary files even when a test fails.

Coverage reports measure Node execution. Functions serialized into Chromium by
`page.evaluate` need browser assertions; their low Node coverage does not mean
they were never exercised. Check behavior coverage alongside the percentages.
See [Node's coverage documentation](https://nodejs.org/docs/latest-v24.x/api/test.html#collecting-code-coverage).

The [architecture overview](docs/overview.md) explains the components, capture
lifecycle, hook responsibilities, testing approach, and future improvements.

## Prerequisites

Install these before installing Eaglediff. The commands below are for Linux
with Bash or Zsh.

| Tool | Minimum / supported version | Recommended setup |
| --- | --- | --- |
| Node.js | **22.12.0**, required by the installed Puppeteer dependency. | **22.19.0**, recorded in `.nvmrc`. |
| pnpm | **9.0.0**, which supports this repository's version 9 lockfile. | **11.17.0**, used for current development. |
| Chrome / Chromium | No verified minimum. Puppeteer **25.12.0** targets Chrome **154.0.8037.57**. | Current Chromium **156.0.8078.47** passed our automated suite. |
| Git | No project-specific version requirement; used to clone the code. | A maintained version from your system's package manager. |

Node **22.12.0** passed all **99 automated tests**. pnpm **9.0.0** completed a
clean install from the existing lockfile without changing it. npm comes with
Node; nvm is an optional helper for installing and selecting Node versions.

See [Puppeteer's Node requirements](https://pptr.dev/guides/system-requirements)
and [browser compatibility table](https://pptr.dev/supported-browsers).
An older browser may work, but has not been verified. Keep the same browser
version when sharing reference screenshots across machines.

### Install missing tools

On Ubuntu/Debian, install Git and curl:

```bash
sudo apt update
sudo apt install git curl
```

Install [nvm using its official instructions](https://github.com/nvm-sh/nvm#installing-and-updating),
then open a new terminal. If nvm is already installed, skip that installation.
Install Node and [pnpm](https://pnpm.io/installation):

```bash
# Install and activate the project's recommended Node version
nvm install 22.19.0
nvm use 22.19.0

# Use it automatically in new terminals (changes your user's default Node)
nvm alias default 22.19.0

# Install the package manager under this Node version
npm install -g pnpm@11.17.0
```

`nvm use` affects only the current terminal. The default applies to new terminals
only if they load nvm. Its installer normally adds this to `~/.zshrc` (Zsh) or
`~/.bashrc` (Bash); if missing, add it once:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

Install [Google Chrome](https://www.google.com/chrome/) or Chromium through your
system's package manager. Eaglediff uses your installed browser; `pnpm install`
does not download one.

### Verify before continuing

Open a **new terminal** and run these without first running `nvm use`:

```bash
git --version
node --version
npm --version
pnpm --version
google-chrome --version || chromium --version || chromium-browser --version
```

Each should print a version. With the setup above, Node should print `v22.19.0`
and pnpm `11.17.0`. If Node is missing, check the nvm startup lines and default
above. If pnpm is missing, reinstall it after activating Node.
For a browser installed elsewhere, set its full executable path, for example
`export CHROME_BIN=/path/to/chrome`, and verify it with `"$CHROME_BIN" --version`.

## Known problems and fixes

### CDN or security verification pages

Built-in checks detect known challenges from **Cloudflare, AWS WAF, DataDome,
and HUMAN/PerimeterX**. When detected, `reference` and `test` stop with a warning
and exit code `1`; existing references are kept. These checks also run without
readiness hooks. Detection is not exhaustive: customized or unfamiliar challenges
may go unrecognized. Ordinary CAPTCHA widgets and CDN scripts alone do not
trigger it.

Use a staging/development environment, or ask the site's administrator about
an exception for authorized test traffic. See
[Cloudflare's exception setup instructions](https://developers.cloudflare.com/waf/custom-rules/skip/).
Available exceptions depend on the service and plan. Eaglediff does not solve
or bypass challenges.

### `env: 'node': No such file or directory`

Node.js is missing or unavailable in this terminal. Check [Prerequisites](#prerequisites)
to install it and set it up for new terminals. If Node **22.19.0** is already
installed through nvm, activate it temporarily for this terminal:

```bash
nvm use 22.19.0
```

Then retry your Eaglediff command.
