# Architecture overview

Eaglediff performs visual regression testing by capturing browser-rendered
content and comparing screenshots with reg-suit. It owns page discovery,
configuration, browser preparation, capture, reference management, and run
history. The comparison engine produces image differences and an HTML report.

The architecture uses a CLI, a capture orchestrator, and small browser hooks.
This keeps project-specific stabilization configurable while sharing capture
and comparison behavior across projects.

## Components

| Component | Responsibility |
| --- | --- |
| `bin/eaglediff.js` | Dispatch commands, resolve project/script directories, check config versions, and preserve the invoking Node runtime for child commands. |
| `scripts/config.js` | Discover internal page links, exclude configured file extensions, and merge scenarios with existing configuration. |
| `scripts/import.js` | Translate Backstop scenarios, viewports, cookies, and supported settings into Eaglediff configuration. |
| `scripts/config-update.js` | Add missing defaults and hooks while preserving explicit overrides and existing hook order. |
| `scripts/run.js` | Coordinate reference capture, testing, approval, browser workers, comparison, and history. |
| `scripts/capture-worker.js` | Execute assigned captures in a worker-owned browser and relay progress, warnings, and errors. |
| `scripts/capture-diagnostics.js` | Summarize capture messages and save full diagnostics in a separate log for each run. |
| `scripts/hooks/` | Prepare page content, wait for resources, normalize variable rendering, and define capture regions. |
| `scripts/hook-path.js` | Resolve bundled hook spellings and project-relative or absolute custom hooks consistently. |
| `scripts/results.js` and `scripts/report.js` | Display run history and open the latest or combined comparison report. |
| `scripts/reference-report.js` | Build a reference capture gallery without comparison or approval results. |
| `scripts/comparison-reports.js` | Retain completed comparisons and the latest available images for each screenshot. |

Configuration lives in the project's `config.json`; bundled defaults live in
`config-default.json`. Scenario settings can override defaults. Config updates
fill missing values rather than replacing saved customization.

The capture CLI writes diagnostics lazily to `.reg/logs`, outside the replaceable
report and staging directories. Workers relay warnings, retries and error details
to the parent, which writes the log and console summaries. Error messages/causes
remain intact for callers; only terminal rendering is shortened. If logging
fails, full console output is preserved. Warning deduplication and retry policies
are unchanged.
Warning context carries the capture URL through worker messages; summaries keep
it complete while abbreviating the explanation.

## Capture lifecycle

A capture runs in a fresh browser context, isolating cookies and browser storage
from other scenarios. Reference captures use `referenceUrl` when supplied;
test captures use `url`. The test URL, label, and viewport define screenshot identity
so different reference destinations still compare under the same filename.
Backstop import reports repeated URLs and keeps variants with distinct labels.
Only repeated URL/label combinations receive unique scenario IDs during import.
Unlabeled scenarios without IDs retain their existing filenames; labeled scenarios
need fresh references after upgrading.

The orchestrator applies cookies and before-navigation hooks, navigates, then
runs readiness hooks. It applies final hide/remove selectors and optional test
content, rechecks configured fonts, calculates selector clipping, and saves the
screenshot. Full-page and clipped captures include a preliminary rendering pass
to settle layout before saving the final image.
`captureBeyondViewport` defaults to "auto": full-page captures with visible
iframes use Puppeteer's viewport-expanding mode, then restore the viewport.
Explicit true/false force either mode. Height-dependent layouts can change.
`hooks/prepare-iframes` waits for visible nested frame documents when
`waitForIframes` is true (the default). It is deferred until after other ready
hooks and page edits, before final font checks and clipping. Removing the hook
skips waiting and automatic iframe capture adjustment; explicit true/false
capture modes still work. `iframeTimeout` bounds the total wait;
timeouts use temporary capture retries. Hidden and one-pixel frames are ignored.
Selector clipping keeps its existing capture mode.

`hooks/stabilize-svg-animations` runs after embedded documents load, before final
image/font checks and clipping. It stops recognized SVGator players and native
SVG timelines, including SVG documents in object/embed elements; ordinary HTML
frames are left alone. `svgAnimationTimeout` bounds readiness and participates
in temporary retries. Hidden SVGs are skipped.

The `fail-on-response-status` hook uses `http404Policy` for main-document 404s:
`warn` (the default) reports the URL and continues capture; `error` stops it.
Scenario values override defaults, including for configs that already list 404
in `failOnResponseStatusCodes`. Other configured HTTP errors still stop capture;
image failures and challenge detection retain their separate policies.

Built-in challenge checks inspect main-document Cloudflare/AWS WAF response
headers and known Cloudflare, DataDome, and HUMAN/PerimeterX page markers. They
run independently of configured hooks, including before the final screenshot
write. Page discovery uses the same detector before collecting links and rejects
header challenges during navigation. Blocked discovery leaves config and
`.gitignore` unchanged. A detected challenge stops captures without retries or baseline promotion;
failed captures cannot be approved. Detection is intentionally non-exhaustive.

Stable-content timeouts report the wait phase and matching elements, including
hidden loader scripts. They participate in fresh-context retries and timeout
scaling, including the legacy `waitForTimeout` setting; missing content is not
accepted as stable.

Temporary navigation, readiness, image, font, and browser failures can retry
within the configured limit. Each retry creates a fresh context; configured
readiness budgets can increase without changing worker count. Disconnected
browsers are replaced for subsequent attempts. Diagnostics identify the page,
viewport, failing hook, and relevant resource or navigation state.

Workers receive batches of scenario/viewport pairs. `core.workers` controls
capture concurrency, with a CLI override available. Automated test-file
concurrency is a separate setting and does not change project workers.

## Hook responsibilities and order

Native video placeholders measure their box after source/poster removal, retaining
explicit sizing without a race between empty-video and metadata-derived dimensions.

Hooks run in configured order, with the bundled selector-clipping hook deferred
until after final DOM edits and font readiness. Project-specific order matters:
a selector initialized on `window.load`, for example, can depend on images
finishing first.

`readySelector` is empty by default: pages do not need a footer to be captured.
Set it to a meaningful element when application content must appear before capture.
A scenario's empty string disables an inherited selector wait; other readiness
hooks still run. Existing configs keep saved selectors during updates, including
legacy root selectors when the nested default is blank.

CSS hooks intentionally run before navigation and again during readiness.
Early styles influence page initialization; later application covers document
replacement and subsequent edits. The final font recheck handles requests
introduced by later content changes.
Font failures remain strict for downloads and explicit `requiredFonts` entries.
The font hook exempts unavailable local-only CSS aliases when their source can
be established from readable active stylesheets. It matches face descriptors and
declaration counts so an opaque or JS-created face with the same name cannot
inherit that exemption. Mixed local/download sources remain strict.

`wait-for-jquery-ready` follows the initial lazy-image pass. It waits for DOM
readiness and registered jQuery ready callbacks when the library is available,
including unreleased startup holds. It observes initialization without releasing
holds or changing visibility. New/changed image sources get another lazy-image
pass before subsequent responsive, decoding, background and final font checks.
`jqueryReadyTimeout` bounds the wait and participates in temporary retries;
`waitForJQueryReady: false` or removing the hook disables it. This is not a signal
for arbitrary asynchronous application work; selectors/custom hooks remain needed
where no known startup signal exists. Hidden iframes and analytics requests are
not waited on by this hook.

`wait-for-drupal-ready` has a before-navigation phase that observes script-load
and parser events, wrapping Drupal's `attachBehaviors` to record the attach
function identities present in actual full-document calls. The ready phase runs
after jQuery readiness and waits for any newly registered attach functions.
It never invokes initialization or changes UI visibility. List it in both hook
arrays; removing both entries or `waitForDrupalReady: false` disables it.
The observer/listeners are removed and the original method restored on normal
completion and timeout; context disposal also clears tracking after capture
failures. `drupalReadyTimeout` is bounded and participates in fresh-context
retries. Images introduced during the wait are rechecked.
This targets standard main-document Drupal initialization; deliberate deferred
behaviors or component-only startup can require opting out. jQuery readiness
alone cannot establish Drupal startup, and persistent missed initialization
requires a site fix rather than a longer delay.
Timeout diagnostics distinguish pending functions after observed full-document
calls from startup that was never observed. Script-load/parser observation can
miss a definition and immediate startup within one bundled script; in that case
the timeout does not establish that initialization actually failed.

Image hooks have distinct responsibilities:

- `load-lazy-images` promotes lazy sources, waits for decoding, and optionally
  recovers stalled HTTP downloads on the current page.
- `normalize-responsive-images` pins the loaded picture candidate and verifies
  decoding so responsive selection does not introduce a different source.
- `normalize-image-decoding` normalizes eligible JPEG rendering and freezes GIF images at their first frame.
- `wait-for-background-images` validates CSS background URL layers and remaining
  foreground images with bounded waits and the configured failure policy.
  CSS-hidden backgrounds are skipped, including hidden ancestors; offscreen
  backgrounds and root/body canvas backgrounds remain checked. This visibility
  filter applies to CSS backgrounds only.

Stalled image waits fail even in warning mode because unresolved downloads can
change layout after capture. Broken image handling follows `imageFailurePolicy`.
The runner records image response status, content type, and network failures from
before navigation. Capture errors include matching resource details when available;
tracking is disposed with each capture attempt and does not add requests or retries.
Network-idle waiting is best effort for expected timeouts; browser failures
propagate to capture recovery.

Carousel stabilization detects supported instances through known selectors when
`carouselSelectors` is null; explicit lists restrict it and `[]` disables it.
After resetting a gallery, it rechecks lazy sources, decoding, and backgrounds.

Hooks can hide dynamic content, replace random content, pause media, stabilize
carousels, or apply project CSS. These transformations are configuration choices:
they determine which visual behavior the project compares.

## Baselines, comparison, and approval

Screenshots and reports are stored under the project's `.reg` directory;
`results.json` stores comparison history.

Full reference runs replace the reference set. Filtered reference runs update
only selected baselines, preserving unrelated screenshots. Testing stages the
selected captures and references for reg-suit comparison.
A completed reference run also builds a gallery under `.reg/reference-report`.
Plain `report` selects the latest comparison or successful reference operation;
`report --reference` always displays the current reference images. Viewing the
gallery never creates a comparison result or approval manifest.

`calibrate` follows the comparison pipeline using an in-memory copy of the
config with `testBaseURL` set to `referenceBaseURL`. Capture navigation uses
`referenceUrl` paths while filenames retain their normal test identity. It
requires existing selected references, preserves saved config and baselines,
and records the effective reference-site comparison in results history.

Passing comparisons exit with code `0`; changed, new, or deleted screenshots
return `1`. Reports and history remain available when differences are found.

`--last-failed` maps changed/new screenshot names from the latest completed
comparison back to current scenarios, selecting those pages at every configured
viewport. Missing identities are reported; an empty failure set is a no-op.
It cannot be combined with `--filter`. Both forms are partial operations and
preserve unrelated references and approval scope.

Completed comparisons also publish immutable image generations under
`.reg/reports`, with one atomic pointer to the latest combined state and HTML.
Filtered runs replace only their entries; full comparisons replace the set.
Unreferenced generations are pruned. A lock prevents overlapping report updates;
an interrupted update leaves the previously published generation available.
`report --all` opens that combined view with per-entry test times. It does not
recapture or recompute comparisons, and never changes the current approval manifest.
Existing completed reports can seed the store; already overwritten reports cannot.
Reference captures retain the comparison report and invalidate its approval
manifest. Failed captures do not replace the saved completed comparison.


A completed comparison writes a capture manifest identifying its screenshots
and whether it covered the full scenario set. Approval uses that manifest and
checks that all selected source files exist and have PNG headers before changing
baselines. A filtered comparison updates only its captured references; a full
comparison can replace the complete set. An approval filter narrows selection
further. Failed captures and comparison-engine failures do not create a new
approvable manifest.

## Tests and quality measurement

The suite combines pure-function tests, CLI integration tests, and real-browser
tests against local fixtures. It covers configuration, import, cookies,
navigation diagnostics, retries, workers, fonts, image loading and normalization,
CSS/content transformations, screenshot geometry, baseline preservation,
approval, comparison exit codes, and history.

See [Contributing](../README.md#contributing) for setup and test commands:

```sh
pnpm run test:unit
pnpm run test:coverage
```

Node coverage measures execution observed by the Node collector. It does not
measure Chromium execution inside `page.evaluate`, and unexecuted modules can
be absent from the report. Browser assertions and an explicit source inventory
are necessary alongside coverage percentages.

Useful quality measures include branch coverage, function complexity,
duplicated code, flaky-test rate, capture duration, peak memory, and retry counts.
[ESLint's complexity rule](https://eslint.org/docs/latest/rules/complexity) and
[jscpd](https://github.com/kucherenko/jscpd) can provide complexity and duplication
measurements. Establish baselines before enforcing thresholds, then prevent
regressions. Baseline integrity and accurate test outcomes matter more than an
aggregate quality score.

## Future improvements

These are development directions rather than requirements for using Eaglediff.

1. **Separate orchestration responsibilities.** Extract baseline storage,
   worker scheduling, the capture pipeline, the comparison adapter, and history
   formatting from `run.js`. Preserve behavior with integration tests while
   making each module easier to understand and change.
2. **Unify configuration validation.** Validate settings before browser startup
   or filesystem changes. Define consistent meanings for null, false, zero, and
   empty arrays. Share script-list normalization, config/import deep merging,
   setting precedence, and result formatting while keeping config-update's
   fill-missing behavior distinct.
3. **Strengthen storage integrity.** Stage baseline and history changes for
   atomic replacement where practical. Introduce a project lock or independent
   run directories so overlapping invocations cannot delete each other's work.
4. **Make capture phases explicit.** Formalize preparation, page readiness,
   deterministic transformations, final asset/layout checks, clipping, and
   capture. Preserve project-specific dependencies. Recheck assets introduced
   by late carousel changes and define whether placeholder replacement should
   require the original image to load successfully.
5. **Broaden lifecycle tests.** Add coverage for worker launch failure,
   cancellation, disconnects during different capture phases, stable-content
   readiness, interrupted storage writes, overlapping runs, and complete hook
   pipelines. Keep assertions focused on saved images, reports, status codes,
   and preserved files.
6. **Establish automated quality checks.** Add CI with a consistent browser
   environment, linting, formatting, and coverage tracking. Run CPU-stress and
   repeated flake checks separately from normal contributor tests. Consider
   mutation testing for configuration, retry policy, and baseline lifecycle.
7. **Measure scheduling before changing it.** Track capture duration, memory,
   and worker utilization. Consider dynamic task assignment if static batches
   leave workers idle on representative workloads.
8. **Clarify environment and distribution settings.** Make certificate bypass
   and browser sandbox options explicit environment choices. Complete license
   and package metadata before public distribution; choose npm publication
   settings separately from GitHub hosting.
