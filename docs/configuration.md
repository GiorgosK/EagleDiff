# Commands and configuration

## Commands

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

`--filter` matches labels, IDs, and URL paths, queries or fragments, ignoring
the URL's domain. Matching is case-insensitive; commas separate alternatives.
`--last-failed` selects failed pages at
all configured viewports and cannot be combined with `--filter`. It does nothing
when no pages failed; removed or renamed identities may no longer match.
Both options work with `reference`, `test`, and `calibrate`.

`--workers` overrides `core.workers`, whose default is `10`. Each page/viewport
pair is a separate capture. `--no-clean` keeps cached captures; it does not make
a full reference run a filtered update.

Filtered comparisons preserve unrelated references when approved.
`approve --filter=...` narrows approval further. A run with failed captures
cannot be approved, though its report still shows the other pages. Completed comparisons exit `0` when passing and `1` for changed, new,
or deleted screenshots; reports and history remain available.

`report --all` uses saved results without retesting. Run a full `test` or
`calibrate` to populate it; overwritten older images cannot be recovered.

### Page discovery

`config` preserves saved URLs, settings, and scenarios while merging discovered
pages. Set `--limit` to change the discovery limit; the homepage counts toward it.
Edit saved base URLs directly to change environments. The command adds `.reg/`
to the project's `.gitignore`.
If the page redirects while links are being read, discovery retries the inspection
up to twice, within a 30-second readiness budget. Links use the final page URL.

`excludeExtensions` skips file links, including common documents and archives by
default; see [config-default.json](../config-default.json) for the list. For example:

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

## Team or agency defaults

A team can keep its own defaults, such as the cookie banner and chat widget
selectors used on all its sites, in one JSON file. `config`, `import` and
`config-update` merge it over Eaglediff's defaults. Each project config is still
complete on its own, so commit it as usual.

```json
{
  "defaults": {
    "hideDynamicSelectors": [".agency-cookie-banner", "#agency-chat"],
    "delay": 800
  },
  "core": { "thresholdRate": 0.002 }
}
```

Eaglediff uses the first file it finds:

```bash
# 1. A file given on the command line
eaglediff config --ref=https://example.com --defaults ~/agency/eaglediff-defaults.json

# 2. A file named by an environment variable
export EAGLEDIFF_DEFAULTS=~/agency/eaglediff-defaults.json

# 3. The user file, if it exists
#    ~/.config/eaglediff/defaults.json ($XDG_CONFIG_HOME/eaglediff/defaults.json)
```

`EAGLEDIFF_DEFAULTS=none` ignores all of them. Settings merge key by key. Lists of
text, such as selectors and hooks, keep Eaglediff's entries and add the team's.
Other values and lists, such as `viewports`, replace Eaglediff's. The file cannot
set `version`, URLs or `scenarios`, which belong to each project.

`config-update` only fills settings a project does not have yet. A project that
already has its own `hideDynamicSelectors` list keeps it unchanged; add the
team's selectors there by hand.

## Settings

Edit your project's `config.json`. Default values are in
[config-default.json](../config-default.json); examples below cover project-specific values.
All durations are milliseconds. Hook names below omit `hooks/`; use the
[default lists](site-adjustments.md#default-hooks) for placement. `-` means built-in handling.

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
| `delay` | Defaults or scenario | Pause before ready hooks, default `500`. Existing configs keep their saved value; a page whose content starts late (for example a JavaScript widget) may need a longer scenario `delay`. | - |
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
| `core.thresholdMaxPixels` | **Root:** most changed pixels allowed in one screenshot, default `500`; `null` turns it off. See [Comparison thresholds](#comparison-thresholds). | - |
| `core.temporaryErrorRetries` | **Root:** retries temporary capture failures in a fresh browser context. Default `2`; `0` disables retries. It does not override image or HTTP error policies. | - |
| `core.temporaryErrorRetryMode` | **Root:** `"immediate"` (default) retries as failures occur; `"deferred"` retries failed captures one at a time after the initial captures finish. | - |
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
| `browserVerification.challengeSelectors` | Identify verification; wait for its markers to disappear or its screen to be replaced. | `wait-for-browser-verification` |
| `browserVerification.settleDelayMs` | After verification is detected, its structure must stay absent in a ready document for this long; default `500` milliseconds. | `wait-for-browser-verification` |
| `browserVerification.errorSelectors` | Visible error markers that fail capture during verification. | `wait-for-browser-verification` |
| `browserVerification.timeout` | Total wait budget, including redirects and settling, default `30000` milliseconds. | `wait-for-browser-verification` |
| `waitForStableContent.triggerSelectors` | Only wait when at least one trigger exists. With no triggers, a target must already exist. | `wait-for-stable-content` |
| `waitForStableContent.selectors` | Elements to watch for stable dimensions, child count, and text length. | `wait-for-stable-content` |
| `waitForStableContent.timeout` | Maximum wait per stage for targets to appear and settle. Timeouts report matched elements and can retry. | `wait-for-stable-content` |
| `waitForStableContent.settleDelayMs` | How long the watched measurements must remain unchanged. | `wait-for-stable-content` |
| `waitUntilGone` | Wait for all matches to disappear or become hidden. | `wait-until-gone` |
| `waitUntilGoneTimeout` | Maximum wait per selector. | `wait-until-gone` |
| `scrollStepDelayMs` / `scrollSettleDelayMs` | Pause between scroll steps and after returning to the top; defaults are 100 and 300. | `scroll-to-bottom` |
| `stabilizeSVGAnimations` | Stop recognized SVGator players and native SVG animations at the start. Default `true`; `false` disables it. | `stabilize-svg-animations` |
| `svgAnimationTimeout` | Maximum wait for embedded SVGs and supported players, default `15000` milliseconds. Timeouts can retry. | `stabilize-svg-animations` |
| `freezeWebAnimations` | Freeze time-based browser animations at their first frame. Default `true`; `false` disables it. | `freeze-web-animations` |
| `carouselSelectors` | Pause supported carousels and return them to the first slide. `null` detects known libraries; `[]` disables it. | `stabilize-carousels` |
| `carouselSettleDelayMs` | Pause after resetting carousels. | `stabilize-carousels` |
| `counterSelectors` | Wait until count-up numbers stop changing. `null` detects known widgets; `[]` disables it. See [Count-up counters](site-adjustments.md#count-up-counters). | `wait-for-counters` |
| `counterTimeout` | Longest wait for counters, default `10000`. A counter still changing after it gives a warning, not an error. | `wait-for-counters` |
| `hideDynamicSelectors` | Apply `display: none`, including to elements added later. | `hide-dynamic-elements` |
| `cookieConsent` | `"hide"` (default), `"accept"` all cookies, or `"leave"` recognized banners alone. Scenario values override defaults. | `handle-cookie-consent` |
| `cookieConsentTimeout` | Wait up to `3000` milliseconds for a banner and its acceptance. A recognized banner that stays open fails capture and can retry. | `handle-cookie-consent` |
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
| `videoCaptureMode` | `"placeholder"` (default) replaces native videos and YouTube/Vimeo embeds; `"first-frame"` pauses native videos at the start and leaves embeds unchanged. | `pause-media` |
| `cssOverrides` | Apply custom CSS to both reference and test captures. | `apply-css-overrides` |
| `networkIdleTime` | Continuous network quiet period required by this hook, default `500` milliseconds. | `wait-for-network-idle` |
| `networkIdleTimeout` | Maximum time spent looking for that quiet period, default `5000` milliseconds. It is not an added delay; expiration continues capture. | `wait-for-network-idle` |
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

## Comparison thresholds

A screenshot passes when its changed pixels stay within all three limits in
`core`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `thresholdRateColor` | `0.05` | How different a pixel's colour must be before it counts as changed (0–1). Smooths tiny rendering differences; it is not a share of pixels. |
| `thresholdRate` | `0.001` | Share of the screenshot's pixels that may change: `0.001` is 0.1%. |
| `thresholdMaxPixels` | `500` | Most pixels that may change in one screenshot, whatever its size. `null` turns this limit off. |

`thresholdRate` grows with the screenshot. A phone capture of a long page can be
360×6000 pixels, where 0.1% is 2,160 pixels: enough to hide a typo in a heading
(about 1,000 pixels), a missing menu item (about 600) or a button moved by 2px
(about 1,500). `thresholdMaxPixels` caps that allowance, so the lower of the two
limits applies:

| Screenshot | 0.1% of its pixels | Allowed with `thresholdMaxPixels: 500` |
| --- | --- | --- |
| 360×640 (one phone screen) | 230 | 230 |
| 1920×1080 (one desktop screen) | 2,074 | 500 |
| 360×6000 (long page on a phone) | 2,160 | 500 |

The value comes from the [benchmark](benchmarks.md): on Drupal's Umami demo the
cap raised the bugs caught from 14 to 18 of 19, without false alarms; a cap of
2000 caught none of the extra four. On five real sites the largest
change in a capture that otherwise passed was 60 pixels, so 500 leaves a wide
margin for rendering noise. Only very small changes, such as rounded image
corners, still pass.

Raise `thresholdMaxPixels` if a site shows small, harmless differences between
runs (check with `calibrate` first), or set it to `null` to use `thresholdRate`
alone, as before version `2026.11.22.01`. `config-update` adds the setting to
existing configs, so update and then recalibrate.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `EAGLEDIFF_DIR`, `EAGLEDIFF_PROJECT_DIR`, `EAGLEDIFF_ROOT` | Project directory for scripts. Prefer the CLI's `--dir` option. |
| `EAGLEDIFF_CONFIG`, `GLOBAL_EAGLEDIFF_CONFIG` | Override the config file path. |
| `EAGLEDIFF_SCRIPT_DIR`, `EAGLEDIFF_HELPER_DIR` | Runner checkout containing scripts and defaults. Prefer `--script-dir`. |
| `EAGLEDIFF_INVOCATION_DIR` | Original working directory passed by the CLI to resolve import paths. |
