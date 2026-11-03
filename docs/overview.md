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
| `scripts/hooks/` | Prepare page content, wait for resources, normalize variable rendering, and define capture regions. |
| `scripts/hook-path.js` | Resolve bundled hook spellings and project-relative or absolute custom hooks consistently. |
| `scripts/results.js` and `scripts/report.js` | Display run history and open the latest comparison report. |

Configuration lives in the project's `config.json`; bundled defaults live in
`config-default.json`. Scenario settings can override defaults. Config updates
fill missing values rather than replacing saved customization.

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

Built-in challenge checks inspect main-document Cloudflare/AWS WAF response
headers and known Cloudflare, DataDome, and HUMAN/PerimeterX page markers. They
run independently of configured hooks, including before the final screenshot
write. A detected challenge stops captures without retries or baseline promotion;
failed captures cannot be approved. Detection is intentionally non-exhaustive.

Temporary navigation, readiness, image, font, and browser failures can retry
within the configured limit. Each retry creates a fresh context; configured
readiness budgets can increase without changing worker count. Disconnected
browsers are replaced for subsequent attempts. Diagnostics identify the page,
viewport, failing hook, and relevant resource or navigation state.

Workers receive batches of scenario/viewport pairs. `core.workers` controls
capture concurrency, with a CLI override available. Automated test-file
concurrency is a separate setting and does not change project workers.

## Hook responsibilities and order

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

Image hooks have distinct responsibilities:

- `load-lazy-images` promotes lazy sources, waits for decoding, and optionally
  recovers stalled HTTP downloads on the current page.
- `normalize-responsive-images` pins the loaded picture candidate and verifies
  decoding so responsive selection does not introduce a different source.
- `normalize-image-decoding` normalizes eligible JPEG rendering.
- `wait-for-background-images` validates CSS background URL layers and remaining
  foreground images with bounded waits and the configured failure policy.

Stalled image waits fail even in warning mode because unresolved downloads can
change layout after capture. Broken image handling follows `imageFailurePolicy`.
Network-idle waiting is best effort for expected timeouts; browser failures
propagate to capture recovery.

Hooks can hide dynamic content, replace random content, pause media, stabilize
carousels, or apply project CSS. These transformations are configuration choices:
they determine which visual behavior the project compares.

## Baselines, comparison, and approval

Screenshots and reports are stored under the project's `.reg` directory;
`results.json` stores comparison history.

Full reference runs replace the reference set. Filtered reference runs update
only selected baselines, preserving unrelated screenshots. Testing stages the
selected captures and references for reg-suit comparison.

Passing comparisons exit with code `0`; changed, new, or deleted screenshots
return `1`. Reports and history remain available when differences are found.

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
