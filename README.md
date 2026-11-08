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

From your project's root folder, create a test folder and compare the site against itself:

```bash
mkdir -p tests/eaglediff
cd tests/eaglediff

# Find up to 25 pages and create config.json
eaglediff config --ref=https://example.com

# Save the reference screenshots
eaglediff reference

# Inspect the saved reference captures
eaglediff report

# Compare fresh captures of the reference site with those references
eaglediff calibrate

# Open the comparison report
eaglediff report
```

Calibration should pass when the site is stable and the references are correct.
Review both images before changing settings or replacing references. Calibration
uses the reference site without changing your saved `testBaseURL`.

### Compare environments

Once calibration passes, change `testBaseURL` to your staging or local site:

```bash
# Compare the changed environment with your references
eaglediff test

# Open the report to review the differences
eaglediff report
```

## Eaglediff and BackstopJS

Eaglediff is a new project. These are intended strengths, not proven advantages
over BackstopJS. Results across more sites and environments are welcome.

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

## Import From Backstop

```bash
eaglediff import --backstop=/path/to/tests/backstop/backstop.json
```

Import derives base URLs, scenarios, and supported settings. It converts
`asyncCaptureLimit` to `core.workers` unless workers are already set in Eaglediff.
Cookie file paths are made relative to `config.json`. Custom Backstop scripts
are not executed; review the imported config before capturing.

Repeated URLs with different labels stay separate. If URL and label both repeat,
import adds unique IDs and reports them. Screenshot filenames depend on URL, label, viewport, and optional ID; changing
these can require new references. Older labeled
captures from before label-based identity also need new references. Unlabeled
scenarios without IDs retain their filenames.

Re-importing rebuilds the scenario list. To keep manual edits, change the
existing config directly instead.

### Cookies

Use `cookiePath` for a JSON array of cookies, or inline `cookies`. File cookies
are applied first; inline cookies can override the same cookie. Values are not
logged. Each capture uses an isolated browser context.

For reusable test cookies across environments:

```json
{
  "defaults": {
    "cookiePath": "../backstop/backstop_data/engine_scripts/cookies.json",
    "cookieDomain": "current",
    "cookieExpiry": "session"
  }
}
```

Without these overrides, cookie domains and expiry are preserved. A scenario
can disable shared cookies with `cookiePath: null` and `cookies: []`.

## Commands And Config

Run commands in the folder containing `config.json`, or use `--dir <folder>`.
Screenshots and reports are saved in `.reg/`; run history is in `results.json`.

| Command | Purpose |
| --- | --- |
| `config --ref=https://example.com` | Discover up to 25 pages and create or extend the config. For a new config, `--test` defaults to `--ref`. |
| `import --backstop=/path/to/backstop.json` | Import a Backstop configuration. |
| `config-update` | Add missing defaults and hooks while preserving saved settings. |
| `reference` | Replace the reference screenshots. With `--filter`, replace only matching references. |
| `calibrate` | Compare fresh reference-site captures against existing references; leave references and saved URLs unchanged. |
| `test` | Compare test-site captures against references. |
| `report` | Open the latest comparison, or the capture gallery after a reference run. |
| `report --reference` | View reference captures without a comparison. |
| `report --all` | View each screenshot's latest saved result, including results from before filtered reruns. |
| `approve` | Accept the latest completed comparison as the new references. Review the report first. |
| `results` | Show pass counts, timings, workers, and recent history. |
| `clean` | Delete captures, references, reports, and caches. |
| `help` | Show commands and CLI options. |

```bash
# Test matching pages with up to 15 workers
eaglediff test --filter=homepage --workers=15

# Retest pages that failed the latest completed comparison
eaglediff test --last-failed

# Replace those references only, after reviewing the problem
eaglediff reference --last-failed

# Review the latest saved result for every screenshot
eaglediff report --all
```

`--filter` matches labels, IDs, or URLs. `--last-failed` selects failed pages at
all configured viewports and cannot be combined with `--filter`. It does nothing
when no pages failed; removed or renamed identities may no longer match.
Both options work with `reference`, `test`, and `calibrate`.

`--workers` overrides `core.workers`, whose default is `10`. Each page/viewport
pair is a separate capture. `--no-clean` keeps cached captures; it does not make
a full reference run a filtered update.

Filtered comparisons preserve unrelated references when approved.
`approve --filter=...` narrows approval further. Failed captures cannot be
approved. Completed comparisons exit `0` when passing and `1` for changed, new,
or deleted screenshots; reports and history remain available.

`report --all` uses saved results without retesting. Run a full `test` or
`calibrate` to populate it; overwritten older images cannot be recovered.

### Page discovery

`config` preserves saved URLs, settings, and scenarios while merging discovered
pages. Set `--limit` to change the discovery limit; the homepage counts toward it.
Edit saved base URLs directly to change environments. The command adds `.reg/`
to the project's `.gitignore`.

`excludeExtensions` skips file links, including common documents and archives by
default; see [config-default.json](config-default.json) for the list. For example:

```json
"excludeExtensions": [".pdf", ".zip", ".docx"]
```

Use `[]` to allow all extensions. Matching ignores case, queries, and fragments;
the leading dot is optional. Running `config` also removes matching existing
scenarios. Excluded links do not count toward the discovery limit.

## Capture environment

Use a consistent OS, browser version, and fonts when sharing reference images.
Hosting the website in DDEV or Docker does not control the browser that captures it.

## Update An Existing Config

After updating Eaglediff:

```bash
eaglediff config-update
```

Adds missing defaults and hooks while preserving saved values, scenarios,
viewports, and existing hook order. This restores removed default hooks but
keeps explicit disabling values such as `false` or `[]`. Recalibrate afterward.

New configs leave `readySelector` empty. Existing configs retain saved selectors;
set `defaults.readySelector` to `""` and clear any root `readySelector` to stop
waiting for one. Existing retry counts, including `0`, are also preserved.

`version` uses `YYYY.MM.DD.NN`; runner/config revisions increment `NN` on the
same day. Commands offer to update older configs. Non-interactive runs continue
with a warning. Newer configs require confirmation or `--allow-newer-config`;
`config-update` refuses to downgrade them.

## Capture Errors

Terminals show `ERROR:` in red and `Warning:` in orange; logs use plain text.
Capture failures identify the page, viewport, hook, and available resource/network details.
The run stops and cancels remaining workers on a failed capture. Progress lines
mean a capture started, not that its screenshot was saved.

To investigate one page:

```bash
eaglediff reference --filter=problem-page --workers=1
```

This replaces matching references if successful. Navigation errors include
redirects and pending requests. Adjust `navigationTimeout` for slow navigation;
`core.protocolTimeout` is a separate browser-command timeout.

### Blank or incomplete iframe screenshots

The default `prepare-iframes` hook waits for visible iframe documents and uses
`captureBeyondViewport: "auto"` to improve full-page iframe rendering. Nested
frames are included; hidden and one-pixel tracking frames are ignored.

Set `captureBeyondViewport: false` to always expand the viewport for full-page
capture, or `true` to keep its layout size unchanged. Expanding can affect
height-dependent layouts. `waitForIframes: false` disables the document wait;
removing the hook also disables automatic viewport adjustment. Selector clipping
keeps its existing capture mode. Content loaded later may need a custom hook.

## Default Hooks

Hooks prepare pages before capture. `onBeforeScript` runs before navigation;
`onReadyScript` runs afterward. The default lists are shown together below.
When removing a hook, remove each occurrence. `config-update` adds missing
default hooks back; use a documented disabling setting to keep a feature off.

```json
{
  "onBeforeScript": [
    "hooks/wait-for-drupal-ready",
    "hooks/hide-dynamic-elements",
    "hooks/disable-animations",
    "hooks/apply-css-overrides"
  ],
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
    "hooks/wait-for-jquery-ready",
    "hooks/wait-for-drupal-ready",
    "hooks/normalize-responsive-images",
    "hooks/replace-random-content",
    "hooks/apply-css-overrides",
    "hooks/normalize-image-decoding",
    "hooks/wait-for-stable-content",
    "hooks/keep-selectors",
    "hooks/wait-for-background-images",
    "hooks/wait-for-network-idle",
    "hooks/stabilize-carousels",
    "hooks/prepare-iframes"
  ]
}
```

Hooks generally follow list order. Eaglediff defers iframe preparation and
selector clipping until after page edits, with a final font check before clipping.
The CSS hooks apply styles before navigation and again before capture.

## Project-Specific Adjustments

Edit your project's `config.json`. Default values are in
[config-default.json](config-default.json); examples below cover project-specific values.
All durations are milliseconds. Hook names below omit `hooks/`; use the
[default lists](#default-hooks) for placement. `-` means built-in handling.

### Familiar to Backstop users

These share names or concepts with [Backstop settings](https://github.com/garris/BackstopJS#scenario-properties); behavior can differ.

| Setting | Where | Purpose | Hook |
| --- | --- | --- | --- |
| `viewports` | Root | Screen sizes: each entry has `label`, `width`, `height`, and optional `deviceScaleFactor` (1 by default). | - |
| `scenarios` | Root | Pages to capture; each entry has a `url` and optional `label`. | - |
| `url` / `label` | Scenario | Page path or absolute URL, and display name. Paths use the selected environment's base URL. | - |
| `id` | Scenario | Optional extra name to distinguish scenarios with the same URL and label. Import adds it only when needed. | - |
| `defaults` | Root | Shared capture settings, like Backstop's `scenarioDefaults`. | - |
| `onBeforeScript` / `onReadyScript` | Root or scenario | Script lists run before navigation or after navigation and `delay`. Scenario scripts run after the root list. | Listed scripts |
| `delay` | Defaults or scenario | Pause before ready hooks, default `1500`. | - |
| `readySelector` | Defaults or scenario | Optional element to wait for; empty by default. A missing required element fails capture. | `wait-for-element` |
| `readyTimeout` | Defaults or scenario | Maximum selector wait, default `10000`. | `wait-for-element` |
| `hideSelectors` | Defaults or scenario | Hide matching elements, keeping their space. | - |
| `removeSelectors` | Defaults or scenario | Remove matching elements and their space from the DOM. | - |
| `fullPage` | Defaults or scenario | Capture the whole page; `false` captures the viewport. | - |
| `waitUntil` | Defaults or scenario | Navigation readiness: `domcontentloaded` (default), `load` (also waits for initial iframe loads), `networkidle0`, or `networkidle2`. | - |
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
| `core.temporaryErrorRetries` | **Root:** retries temporary capture failures in a fresh browser context. Default `1`; `0` disables retries. It does not override image or HTTP error policies. | - |
| `core.temporaryErrorRetryTimeoutMultiplier` | **Root:** scale readiness timeouts on retry. Default `1`; `2` gives budgets of 1×, 2×, then 4×. | - |
| `fontTimeout` | Maximum wait for web fonts, default `30000` milliseconds. Font timeouts and failed font downloads fail capture and use temporary retries. | `wait-for-fonts` |
| `retryImageDownloads` | Retry stalled HTTP image downloads on the existing page through Node, then require successful browser decoding. Default `false`. Cookies are scoped to each destination, including redirects. | `load-lazy-images` |
| `imageDownloadTimeout` | Maximum time for each recovery download and its subsequent browser decoding, default `15000` milliseconds. | `load-lazy-images` |
| `requiredFonts` | CSS font specifications that must resolve to declared web fonts, for example `["400 16px Inter", "700 16px Quicksand"]`. Default `[]` still checks fonts the page requested. Scenario values replace defaults. | `wait-for-fonts` |
| `core.workers` | **Root:** maximum concurrent captures; `--workers` overrides it. Configs without this setting use `core.workers` from `config-default.json` (currently `10`). | - |
| `core.protocolTimeout` | **Root:** browser-command timeout, default `60000`; separate from navigation/readiness timeouts. | - |
| `cookieDomain` | `null` preserves cookie domains (missing domains use the capture hostname). `"current"` explicitly scopes cookies to the current reference/test hostname; a domain string sets a fixed domain. | - |
| `cookieExpiry` | `null` preserves expiry and warns when expired cookies are skipped. `"session"` removes expiry for reusable test fixtures. | - |
| `captureBeyondViewport` | Default `"auto"`: expand the viewport for full-page captures with visible iframes. `true` keeps the layout viewport unchanged; `false` always expands it. Expanding can affect height-dependent layouts. | `prepare-iframes` for `"auto"` |
| `waitForIframes` | Wait for visible iframe documents to finish loading, including nested frames. Default `true`; `false` disables the wait. Content added after loading may need a project hook. | `prepare-iframes` |
| `iframeTimeout` | Maximum total wait for visible iframes, default `30000` milliseconds. A timeout stops capture and uses configured temporary retries. | `prepare-iframes` |
| `readyVisible` | Require the ready element to be visible as well as present. | `wait-for-element` |
| `http404Policy` | Main-page 404 handling: `"warn"` (default) logs a warning and continues; `"error"` stops capture. Scenario values override defaults. | `fail-on-response-status` |
| `failOnResponseStatusCodes` | Other main-page HTTP status codes that fail capture; 404 uses `http404Policy`. | `fail-on-response-status` |
| `browserVerification.challengeSelectors` | Detect a browser-verification page; wait for these markers to disappear. | `wait-for-browser-verification` |
| `browserVerification.errorSelectors` | Visible error markers that fail capture during verification. | `wait-for-browser-verification` |
| `browserVerification.timeout` | Maximum wait for verification to finish. | `wait-for-browser-verification` |
| `waitForStableContent.triggerSelectors` | Only wait when at least one trigger exists. With no triggers, a target must already exist. | `wait-for-stable-content` |
| `waitForStableContent.selectors` | Elements to watch for stable dimensions, child count, and text length. | `wait-for-stable-content` |
| `waitForStableContent.timeout` | Maximum wait per stage for targets to appear and settle. Timeouts report matched elements and can retry. | `wait-for-stable-content` |
| `waitForStableContent.settleDelayMs` | How long the watched measurements must remain unchanged. | `wait-for-stable-content` |
| `waitUntilGone` | Wait for all matches to disappear or become hidden. | `wait-until-gone` |
| `waitUntilGoneTimeout` | Maximum wait per selector. | `wait-until-gone` |
| `scrollStepDelayMs` / `scrollSettleDelayMs` | Pause between scroll steps and after returning to the top; defaults are 100 and 300. | `scroll-to-bottom` |
| `carouselSelectors` | Pause supported carousels and return them to the first slide. `null` detects known libraries; `[]` disables it. | `stabilize-carousels` |
| `carouselSettleDelayMs` | Pause after resetting carousels. | `stabilize-carousels` |
| `hideDynamicSelectors` | Apply `display: none`, including to elements added later. | `hide-dynamic-elements` |
| `keepCookiebot` | **Scenario only:** skip the entire `hideDynamicSelectors` hook for this page. | `hide-dynamic-elements` |
| `waitForJQueryReady` | Wait for DOM readiness and jQuery startup callbacks when jQuery is present. Default `true`; `false` disables the hook. | `wait-for-jquery-ready` |
| `jqueryReadyTimeout` | Maximum wait for jQuery initialization, default `30000` milliseconds. Timeouts fail capture and can retry. | `wait-for-jquery-ready` |
| `waitForDrupalReady` | Check that Drupal has attached its registered startup behaviors. Default `true`; `false` disables the check. Non-Drupal pages are skipped. | `wait-for-drupal-ready` |
| `drupalReadyTimeout` | Maximum wait for Drupal startup, default `30000` milliseconds. Timeouts fail capture and can retry. | `wait-for-drupal-ready` |
| `imageFailurePolicy` | `"error"` (default) stops for broken images; `"warn"` captures them with a warning. Stalled downloads still fail. | `load-lazy-images`, `normalize-responsive-images`, `wait-for-background-images` |
| `scrollTimeout` | Maximum lazy-content scroll time, default `30000`. Timeouts can retry. | `scroll-to-bottom` |
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

A 404 page is still captured and compared in warning mode, so visual changes can
still fail the test. To stop on 404, set `"http404Policy": "error"` in `defaults`
or an individual scenario.

Root `readySelector`, `readyTimeout`, and `failOnResponseStatusCodes` are also
accepted as fallbacks. A scenario's `readySelector: ""` disables the selector
wait for that page. Otherwise, a blank default still allows a root selector.
Older `waitForTriggerSelectors`, `waitForSelectors`,
`waitForTimeout`, and `waitForSettleDelayMs` map to the corresponding
`waitForStableContent` fields when those nested fields are absent.

### Automatic carousel detection

`carouselSelectors: null` detects Swiper, Slick, Owl Carousel, Bootstrap Carousel,
Fotorama, Flickity, FlexSlider, and Unite Gallery. It pauses supported carousels,
selects their first slide, and checks resulting images. Custom galleries or
unsupported versions may need a project hook.

Use a selector list to restrict detection, or `[]` to disable it. Config updates
preserve existing `[]`; change it to `null` to enable automatic detection.
`carouselSettleDelayMs` defaults to `500`.

The image-decoding hook also freezes GIF `<img>` elements at their first frame.
CSS background GIFs and iframe images are excluded. If cross-origin conversion
is blocked, a working original is kept with a warning and may still animate.
Use `normalizeImageDecodingSelectors: []` to disable conversion.

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

Use your site's selectors. Empty lists disable these settings; carousel detection
is automatic by default.

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

The default config already hides the Google Maps selector above. For a changing
reCAPTCHA badge, add `.grecaptcha-badge`. Review the resulting captures before
replacing references; excluded embed content is no longer compared.

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

Add CSS to `defaults` or a scenario. For example:

```json
"cssOverrides": ".banner { background-image: url('/images/fixed-background.jpg') !important; }"
```

Use an image available on the site. Scenario CSS replaces the default CSS;
`""` disables it for that scenario. Hiding a CAPTCHA or other changing element
excludes it from comparison; review its replacement before updating references.

### Changing videos and social feeds

To replace changing video tiles with plain placeholders, target the wrapper
around each video and its controls. For example, if it has class `.video-tile`:

```json
{
  "url": "/gallery",
  "hideSelectors": [".video-tile *"],
  "cssOverrides": ".video-tile { background: #e2e5e8 !important; }"
}
```

Replace `.video-tile` with your site's selector. The contents become invisible,
keeping their layout space, while the wrapper shows a grey background. This
checks the tile layout and surrounding page, excluding the video content.
Review the placeholders before updating references.

### Web fonts

`wait-for-fonts` checks requested web fonts and repeats before capture.
Use `requiredFonts` to also require specific declared fonts, such as
`["400 16px Inter"]`. Missing or failed fonts stop capture; `fontTimeout`
controls the wait.

### Slow or interrupted captures

`core.temporaryErrorRetries` defaults to `1`: retry a temporary failure in a
fresh browser context. Existing configs keep saved values, including `0`.
A disconnected worker browser is restarted on retry. Retries do not override
image or HTTP error policies.

`core.temporaryErrorRetryTimeoutMultiplier: 2` gives retries longer readiness
budgets: 1×, 2×, then 4×. It does not change workers, delays, or retry count.
Keep `core.protocolTimeout` above the longest resulting readiness budget.

### jQuery and Drupal startup

`wait-for-jquery-ready` waits for jQuery startup callbacks, including startup
holds. `wait-for-drupal-ready` separately checks that registered Drupal startup
behaviors were attached to the document. Both skip when their library is absent.

Use `waitForJQueryReady: false` or `waitForDrupalReady: false` to disable a check.
`jqueryReadyTimeout` and `drupalReadyTimeout` bound their waits. Timeouts fail
capture and can retry; the hooks do not force initialization or hide menus.
Drupal sites that intentionally defer behaviors or initialize only selected
components may need to disable its check. It watches the main page, not iframes.

### Waiting for page content

Library readiness cannot predict later application updates. For a form that
loads asynchronously, use a specific signal:

```json
{
  "url": "/newsletter",
  "readySelector": ".newsletter-form button[type=submit]",
  "readyVisible": true,
  "readyTimeout": 15000
}
```

If it loads only after scrolling, put `wait-for-element` after `scroll-to-bottom`.
Similarly, put image loading before a selector wait that depends on image loading
or the page's load event. `scrollTimeout` bounds scrolling, including pages whose
height keeps growing.

### Lazy images

`load-lazy-images` loads common `data-src`, `data-srcset`, and `data-sizes`
attributes, including `data-lazy-*`, then waits for image decoding. CSS background
images are checked separately. CSS-hidden backgrounds are skipped; visible
backgrounds below the fold are still checked. Newly introduced image sources
are rechecked.

`imageFailurePolicy` defaults to `"error"`. `"warn"` allows broken images with
warnings, so their placeholders can still cause visual differences. Stalled
downloads fail in either mode and can use temporary retries. Hidden empty
`data:,` placeholders are ignored; visible or genuinely broken images are not.

`retryImageDownloads: true` attempts to recover stalled HTTP downloads using the
browser context's cookies. The recovered image must still decode successfully.
`imageDownloadTimeout` limits recovery; it defaults to `15000` milliseconds.

### Scroll reveals, fading icons, and moving decorations

`disable-animations` removes CSS animation delays, but JavaScript can still hide
an element or fade it in. Use `cssOverrides` to show selected content and stop
selected decorations. Replace `.reveal` with your site's selector:

```json
"cssOverrides": ".reveal { visibility: visible !important; opacity: 1 !important; animation: none !important; }",
"waitForStableContent": {
  "triggerSelectors": [],
  "selectors": [".reveal"],
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

Review captures after changing preparation settings, then update references only
when the new appearance is intended. Existing configs need the corresponding
[default hooks](#default-hooks).

## Contributing

Follow [AGENTS.md](AGENTS.md) for development and commit-review requirements.

From the Eaglediff checkout, with [prerequisites](#prerequisites) installed, use
the Node version in `.nvmrc` (`nvm use` if using nvm):

```sh
pnpm install --frozen-lockfile

# Focused tests while developing
node --test tests/lazy-images.test.js

# Complete automated suite before submitting
pnpm run test:unit
git diff --check

# Investigate coverage when needed
pnpm run test:coverage
```

`pnpm test` runs a project's visual comparison; `test:unit` tests Eaglediff itself.
The automated suite uses local fixtures and temporary directories, with at most
four test files in parallel. It needs no production website or project config.

Add regression tests for changed behavior, overrides, failures, and cleanup.
Assert resulting screenshots, reports, exit codes, or saved files. Code running
inside Chromium needs browser assertions; Node coverage alone cannot measure it.

See [docs/overview.md](docs/overview.md) for architecture and implementation details.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `EAGLEDIFF_DIR`, `EAGLEDIFF_PROJECT_DIR`, `EAGLEDIFF_ROOT` | Project directory for scripts. Prefer the CLI's `--dir` option. |
| `EAGLEDIFF_CONFIG`, `GLOBAL_EAGLEDIFF_CONFIG` | Override the config file path. |
| `EAGLEDIFF_SCRIPT_DIR`, `EAGLEDIFF_HELPER_DIR` | Runner checkout containing scripts and defaults. Prefer `--script-dir`. |
| `EAGLEDIFF_INVOCATION_DIR` | Original working directory passed by the CLI to resolve import paths. |

## Prerequisites

Install these before installing Eaglediff. The commands below are for Linux
with Bash or Zsh.

| Tool | Minimum / supported version | Recommended setup |
| --- | --- | --- |
| Node.js | **22.12.0**, required by the installed Puppeteer dependency. | **22.19.0**, recorded in `.nvmrc`. |
| pnpm | **9.0.0**, which supports this repository's version 9 lockfile. | **11.17.0**, used for current development. |
| Chrome / Chromium | No verified minimum; use a browser supported by Puppeteer. | See the [compatibility table](https://pptr.dev/supported-browsers). |
| Git | No project-specific version requirement; used to clone the code. | A maintained version from your system's package manager. |

npm comes with Node; nvm is optional. See
[Puppeteer's requirements](https://pptr.dev/guides/system-requirements) for compatibility.

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

For automatic Node selection, your shell must load nvm. Its installer normally
adds these lines to `~/.zshrc` or `~/.bashrc`; add them if missing:

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

Each should print a version. If Node is missing, check nvm startup and its
default version. If pnpm is missing, reinstall it after activating Node.
For a browser elsewhere, set `CHROME_BIN` or `PUPPETEER_EXECUTABLE_PATH`
to its full executable path.

## Known problems and fixes

### CDN or security verification pages

Built-in checks detect known challenges from **Cloudflare, AWS WAF, DataDome,
and HUMAN/PerimeterX**, even without readiness hooks. Detection stops `config`,
`reference`, `test`, or `calibrate` with exit code `1`, preserving existing configs
and references. Blocked discovery does not write a partial config. Detection is
not exhaustive; ordinary CAPTCHA widgets or CDN scripts alone do not trigger it.

Use a staging/development environment, or ask the site's administrator about
an exception for authorized test traffic. See
[Cloudflare's exception setup instructions](https://developers.cloudflare.com/waf/custom-rules/skip/).
Eaglediff does not solve or bypass challenges.

### No such file or directory

`env: 'node': No such file or directory`

Node.js is missing or unavailable in this terminal. Check [Prerequisites](#prerequisites)
to install it and set it up for new terminals. If Node **22.19.0** is already
installed through nvm, activate it temporarily for this terminal:

```bash
nvm use 22.19.0
```

Then retry your Eaglediff command.
