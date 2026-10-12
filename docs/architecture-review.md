# Architecture and test review

Review date: 2026-10-12. Scope: Eaglediff CLI, configuration/import, capture and
comparison orchestration, bundled hooks, and automated tests. The findings below record the pre-fix implementation; see the
completed follow-up for their current status. No project baselines were modified during verification.

## Completed follow-up

The six confirmed findings have separate fixes and regression tests: filtered
reference preservation, complete/scoped approval, comparison exit status,
final selector clipping, distinct reference URLs, and hook-path resolution.
Additional fixes bound CSS background readiness, preserve selected picture
sources, and propagate browser errors from network-idle checks. Each fix has
its own commit. Contributor test commands are documented in the README.

Post-fix verification: `pnpm run test:unit` completed with **82 passed, 0 failed**
in about 47 seconds. Test-file concurrency is bounded at four to avoid
oversubscribing fixture browsers; project capture workers remain unchanged.

Approval now requires a capture manifest from a completed comparison; rerun
`test` before approving reports created by an earlier version. Visual differences
still produce reports, history, and an approvable manifest, but return exit 1.
A failed capture or comparison engine does not produce an approvable manifest.

The remaining recommendations concern validation consistency, transactional
storage and concurrent invocations, broader phase-order policy, and incremental
module extraction. The original measurements below are the pre-fix baseline.

## Assessment

The structure is appropriate for a small visual testing tool: hooks are small
modules, browser contexts isolate captures, retry budgets are bounded, config
updates preserve explicit overrides, and real-browser tests exercise important
failure paths. Typed readiness errors and detailed navigation diagnostics are
useful foundations. A framework rewrite is unnecessary.

The main weakness is that capture stabilization has received more test coverage
than baseline lifecycle and command semantics. Passing tests currently cannot
be treated as sufficient release evidence.

## Confirmed findings, in priority order

| Priority | Finding | Evidence and suggested correction |
| --- | --- | --- |
| High | Visual differences still exit successfully, which can make a CI job pass. | `scripts/run.js` reads `failedItems` but never sets a failure exit status. A fixture with two changed screenshots returned exit 0. Define exit semantics for changed/new/deleted items, preserve the report/history, and test the CLI status. The existing comparison test detects differences but expects the child process to resolve successfully. |
| High | Filtered reference creation removes unrelated baselines. | `scripts/run.js:98`: the default clean run deletes the entire reference directory before promoting only selected captures. A two-page baseline became one page after `reference --filter=/one`. Replace selected entries only for filtered reference updates; reserve full replacement for a full run. |
| High | Approval after a filtered test removes unrelated baselines. | `scripts/run.js:49` and `promoteActualsToReferences`: approval passes `overwriteAll: true` and no selection. A two-page baseline became one page after a filtered test and approval. Record a successful run's selection and promote only those captures. Validate the complete source before changing baselines. |
| Medium | `keepSelectors` does not affect the capture. | The hook writes `readyContext.keepSelectorsClip`, but `scripts/run.js:300` reads the separate `captureContext`. A requested 20×30 region produced a 100×100 screenshot. Read the current attempt's context and measure the clip after final layout changes. Test the actual PNG dimensions through the full capture path. |
| Medium | Imported reference paths are lost. | `scripts/import.js:103` computes `referenceUrl` for deduplication but omits it from the emitted scenario. Importing test `/new` and reference `/old` emitted only `url: /new`. Capture also uses `getScenarioUrl` in both modes. Preserve and resolve the reference path separately, while retaining one stable comparison identity. |
| Medium | A supported hook spelling resolves to a nonexistent path. | Import accepts `scripts/hooks/foo`, and config-update treats it as equivalent to `hooks/foo`. `scripts/run.js:1007` prefixes either spelling with `scripts`, producing `scripts/scripts/hooks/foo.js` for the former. Use one shared hook normalizer/resolver and test both spellings through capture. |

Reproduction output from isolated temporary fixtures:

```text
Full reference count: 2
After filtered reference: 1 (expected 2)
Visual differences: 2 CLI exit: 0 (execFile resolved)
After approving filtered test: 1 (expected 2)
keepSelectors capture: 100x100 (expected 20x30)
Imported reference path: {"label":"Different paths","url":"/new"} reference base: https://ref.example
```

## Hook overlap and order

The CSS hooks run before navigation and again during readiness. This is
intentional: early styles affect page initialization and late application covers
replacement documents or subsequent edits. The font hook's final recheck is
also intentional and tested against font requests introduced by later edits.
Those repetitions should not be removed merely to reduce the hook count.

Image handling has overlapping responsibilities: `load-lazy-images` promotes
and decodes images, `normalize-responsive-images` changes sources and decodes
again, `normalize-image-decoding` fetches/decodes JPEGs, and
`wait-for-background-images` checks foreground images again as well as CSS
backgrounds. Splitting responsibilities is reasonable, but they need a common
bounded readiness contract.

Specific concerns visible in the code:

- `wait-for-background-images` has no resource timeout, ignores decode failures,
  and extracts only the first `url(...)` in a background value. A stalled image
  waits until the browser protocol timeout, without the image-specific retry
  code or diagnostics. Add explicit timeout/failure policies and fixtures for
  multiple backgrounds, missing images, and stalled responses.
- `normalize-responsive-images` preserves the current IMG source, then changes
  PICTURE sources to the first srcset candidate. The browser can choose a
  different image after the earlier load check. Decode failures are swallowed.
  Test multi-candidate pictures and verify the selected source stays loaded.
- Default selector readiness precedes image recovery. A selector initialized on
  `window.load` can block the recovery step when an image stalls. Digital Unite
  uses a different order for this reason. Document dependencies and test a full
  default pipeline, rather than assuming one order works for every page.
- Random image replacement follows strict image loading. A broken original
  selected for replacement can fail before its placeholder is installed.
  Decide whether replacement should bypass original loading and test that
  policy explicitly.
- `keep-selectors` precedes background loading, network settling, carousel
  changes, and final element removal. Its bounds can become stale even after
  the context bug is fixed. Measure clipping after final DOM changes.
- Carousel stabilization happens after the final general image wait. A slide
  change can request new images. Recheck assets/layout after the last mutation.
- Best-effort network-idle handling catches every error, including browser
  disconnection. Ignore only expected idle timeouts and let other failures reach
  the browser recovery policy.

Prefer explicit phases: prepare document, navigate, satisfy page-specific
readiness, apply deterministic content/style changes, validate final assets and
layout, calculate clipping, capture. Allow page-specific dependencies inside
those phases. Avoid introducing a universal order without integration tests.

## Maintainability and other considerations

`scripts/run.js` is 1,053 lines and combines CLI parsing, configuration, capture,
worker scheduling, screenshot naming, filesystem promotion, comparison, and
history formatting. Extract coherent modules incrementally: baseline storage,
worker pool, capture pipeline, comparison adapter, and results formatting. Keep
`run.js` as orchestration. Add lifecycle regression tests before moving code.

Other worthwhile improvements:

- Centralize hook-path normalization, script-list normalization, the repeated
  deep-merge implementation in config/import, setting precedence, and result
  formatting. Keep config-update's intentional fill-missing semantics distinct. They are currently implemented in several
  places. Prefer a few focused helpers over a generic hook framework.
- Validate configuration before launching browsers or removing files. Many
  settings use `||` while others use `??` or own-property checks, so disabling
  values have inconsistent meanings. Define null/false/zero/empty-array
  semantics and reject invalid viewports, retry counts, selectors and budgets.
- Make storage changes transactional. Baseline promotion deletes/copies files
  individually, and history writes replace JSON directly. An interrupted write
  can leave partial state. Use validated staging and atomic replacement where
  practical. Lock the project or allocate separate run directories: concurrent
  invocations currently share and delete the same `.reg` paths.
- Worker batches are statically assigned; a slow batch can leave other workers
  idle. Consider a task queue only after measuring a real throughput problem.
  Add tests for worker launch failure, cancellation, disconnect during capture,
  and cleanup of sibling browsers. Recovery currently has a test for browser
  creation failure, which is narrower than all disconnect phases.
- Make certificate bypass and Chrome sandbox options explicit environment
  choices. They are currently enabled unconditionally for local compatibility,
  including Node image recovery's disabled certificate verification.
- Keep an eye on browser-visible state names: `wait-for-stable-content` still
  uses `window.__regSuitStableContentState`, although branding changed. This is
  internal state, not an old CLI compatibility mechanism.
- The README's stated default extension exclusions only list PDF, while the
  bundled defaults exclude office documents and archives too. Derive examples
  or validate documentation against defaults to avoid drift.
- There is no tracked CI workflow, lint configuration, or formatter
  configuration. Establish these incrementally with pinned development tools.
  Pick a license and repository/package metadata before public distribution;
  `private: true` currently prevents npm publication, not GitHub hosting.

## Test assessment

Command run on Node 24.18.0 with local Chrome:

```sh
node --test --experimental-test-coverage tests/*.test.js
```

Result: **71 passed, 0 failed**, about 34 seconds.

Good existing coverage includes config discovery/update, import worker limits,
cookies, navigation diagnostics, retries and adaptive budgets, worker partitioning,
fonts, lazy images and recovery, JPEG processing, randomized content replacement,
CSS overrides, screenshot geometry, comparisons, and results history.

Highest-value additions are the confirmed failures above, followed by a full
hook-pipeline fixture, delayed/broken CSS backgrounds, responsive picture
selection, carousel-driven image changes, stable-content readiness, graceful
cancellation, storage interruptions, and overlapping runs. Assertions should
check user-visible outcomes, not merely that a hook ran.

## Quantitative quality baseline

| Measure | Observed baseline | How to use it |
| --- | --- | --- |
| Automated tests | 71 passing; 0 failing | Require the suite to pass before merging. |
| Node line coverage | 76.62% | Track change over time and inspect uncovered behavior. |
| Node branch coverage | 75.79% | Prioritize decision paths in storage, CLI and retries. |
| Node function coverage | 84.05% | Useful alongside branch coverage, not as a release score. |
| Largest source module | `run.js`: 1,053 lines | Track module responsibilities and function size during extraction. |

These coverage totals describe files observed by Node's coverage collector.
They do not include Chromium execution inside `page.evaluate`, and unexecuted
modules can be absent from the report. For example, reported low coverage of
image hooks cannot by itself establish missing browser tests. Use an explicit
source inventory and browser assertions before imposing repository-wide gates.

Suggested additional measures, not yet measured or configured:

- Cyclomatic complexity per function using
  [ESLint's complexity rule](https://eslint.org/docs/latest/rules/complexity).
  Start with warnings above 15 and ratchet down; this is a proposed threshold.
- Duplicated code percentage using
  [jscpd](https://github.com/kucherenko/jscpd), excluding dependencies, generated
  reports and fixtures. Establish a baseline before adding a failure threshold.
- Flake rate: repeated failures / repeated test runs under fixed browser and
  machine conditions. Add a separate CPU-stress job rather than slowing every
  developer test run.
- Performance: median/p95 capture and suite durations, peak memory, recovery
  counts and retry counts, measured on fixed local fixtures.
- Mutation testing for configuration merging, scenario identity, retry policy,
  and baseline lifecycle. Tests should fail when important checks are removed.

There is no single credible overall quality score. Prioritize baseline integrity,
accurate CI status, and regression tests over maximizing a coverage percentage.
