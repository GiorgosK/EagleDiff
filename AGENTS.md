# Instructions for AI-assisted development

These instructions apply to all AI assistants working in this repository.
Read them before changing files. Read [README.md](README.md) for commands and
[docs/architecture.md](docs/architecture.md) for architecture and future improvements.

Before starting new work, read `TODO.md` and the `notes/` folder when they
exist, and check them for pending related tasks, earlier decisions and test
beds. Both are local working notes, ignored through `.git/info/exclude`: never
commit them or copy their private details into tracked files. When work
changes what they say, offer to update them.

## Human review and commit approval

- Implement and validate requested changes, then leave them uncommitted for
  human review. Do not automatically commit when implementation finishes.
- Make the review understandable without requiring the human to reconstruct
  the conversation or inspect every code change. Use plain language, concrete
  examples, and relevant file links; explain technical details when needed.
- Prefer short, concise answers and small, practical explanations over long
  descriptions. Include the essentials needed to understand and review the
  change; avoid repetition and unnecessary background. Let the human ask for
  further detail rather than providing lengthy explanations by default. Keep
  material risks and verification limits clear even when being brief.
- Before requesting commit approval, explain:
  - **The problem:** what triggered it, the observed behavior, and its impact.
  - **The solution:** what changed, why it solves the problem, and the expected
    behavior after the change. Include a before/after example when useful.
  - **Limitations and pitfalls:** uncovered scenarios, assumptions, edge cases,
    compatibility impacts, and remaining risks. Distinguish known limitations
    from uncertainty; do not imply that untested cases have been verified.
  - **Automated verification:** the tests and checks run, their commands and
    results, what they demonstrate, and what they do not cover. Identify skipped
    or blocked checks and explain why they were not completed.
  - **Manual validation:** practical steps the human can follow, including
    prerequisites, exact commands or actions, and expected results. Identify
    any steps that modify data or baselines. For documentation-only changes,
    explain what to review instead of inventing unnecessary runtime tests.
- Then ask the human to confirm that the reviewed changes should be committed.
  Allow them to inspect or manually test the result before deciding.
- An initial request to fix and commit something does not replace this final
  review step. A human instruction to commit the already reviewed changes
  counts as confirmation; do not ask again for that same reviewed diff.
- Approval covers only the reviewed changes. If substantive changes are needed
  afterward, validate them and obtain fresh confirmation before committing.
- After approval, create focused commits, separating independent fixes and
  features. Include each fix's regression tests in its commit.
- Attribute material AI assistance with an `Assisted-by: TOOL:MODEL` commit
  trailer, using the actual tool and model when known; do not invent identities.
- Do not push, publish, amend commits, or rewrite history without separate
  explicit authorization. Never bypass hooks or validation to finish a task.

## Scope and compatibility

- Inspect Git status and relevant code/tests before editing. Preserve unrelated
  changes and user work; never reset or discard them to obtain a clean tree.
- Make the smallest coherent change that solves the requested problem. Keep
  unrelated refactors and dependency upgrades separate.
- Preserve established CLI commands, flags, exit semantics, config overrides,
  screenshot identity, and hook behavior unless the requested change requires
  otherwise. Explain any compatibility impact before making it.
- Update documentation when behavior, defaults, configuration, or commands
  change. When a config revision is required, follow the version convention in
  docs/configuration.md and test config-update without losing explicit overrides.
- Prefer project configuration for site-specific behavior. Add runner features
  when they solve a general problem; keep defaults predictable.
- Do not change worker counts, comparison thresholds, hide selectors, or image
  failure policies simply to make a failing comparison pass.

## Code quality

- Follow the existing CommonJS style and use clear names and small modules with
  one responsibility. Extract focused helpers where duplication causes drift;
  avoid speculative frameworks or abstractions for a single use.
- Define configuration precedence and disabling values explicitly. Use `??`
  when valid false/zero/empty values must survive; validate invalid input before
  browser startup or filesystem mutations.
- Bound waits, downloads, and retries. Preserve error causes and actionable
  diagnostics. Catch only expected errors; browser failures must reach recovery.
- Keep hooks' dependencies and ordering understandable. Revalidate assets
  introduced by late mutations and calculate clipping from the final layout.
- Keep browser contexts isolated. Close browsers, pages, contexts, servers,
  timers, and listeners on success, failure, cancellation, and retries.
- Preserve the runner's Node runtime in child commands. Use `.nvmrc`, pnpm, and
  the lockfile consistently. Justify new dependencies and verify their APIs
  and compatibility rather than assuming them.

## Tests and verification

- Behavioral changes need meaningful coverage. For a bug, add a regression test
  that fails with the old behavior and passes with the fix when practical.
  Cover new behavior, relevant overrides, and important failure paths.
- Assert outcomes: PNG geometry/content, comparison results, exit codes,
  preserved files, configuration, and cleanup. Avoid tests that merely repeat
  implementation logic or prove that a function was called.
- Use local deterministic fixtures and temporary directories. Automated tests
  must not depend on production websites, private project data, or credentials.
- During development, run tests for the affected area. Run the fast safety checks
  after a coherent change, especially when touching shared runner or config code:

  ```sh
  node --test tests/<affected-area>.test.js
  pnpm run test:fast
  git diff --check
  ```

- The fast list is in `tests/fast-tests.json`; keep test files where they are.
  It covers screenshot identity, config compatibility, error output, reference
  preservation, approval, and comparison exit codes. These are sensitive areas,
  not a list of flaky tests. Other tests remain important and must be selected
  when their behavior changes; the fast set does not cover every hook.
- Do not automatically run the full suite during development or before presenting
  changes for review. Continue with focused tests and `pnpm run test:fast` until
  the human requests commits.
- When the human requests commits containing code changes, ask to run
  `pnpm run test:unit` before committing, unless they have already explicitly
  requested that full run. Run it after confirmation and report the result.
  A successful full run covering the current code need not be repeated. If later
  code changes invalidate it, ask before rerunning. Documentation-only changes
  need diff/link/command review, not a full runtime suite.

- Use `pnpm run test:coverage` to investigate gaps when needed. Node coverage
  does not measure code executing in Chromium through `page.evaluate`; provide
  browser assertions for those paths. Do not pursue percentages with weak tests.
- `pnpm test` is the project's visual comparison command, not the automated
  test suite for Eaglediff itself.
- For refactors, verify existing behavior and add tests for newly discovered
  gaps. Documentation-only changes require diff/link/command review; a browser
  suite is unnecessary unless executable behavior also changes.
- Do not weaken assertions, remove tests, hide failures, or repeatedly rerun a
  flaky test until it passes. Investigate and report the cause. If a check cannot
  run, explain the missing prerequisite and what remains unverified.
- For changes affecting real screenshots or project integration, recommend
  concrete manual checks alongside automated results. Use an isolated test
  directory unless the human has authorized modifying project test data.

## Baseline and data integrity

- Never overwrite or approve a project's real references to silence a failure.
  Obtain explicit authorization for baseline regeneration, approval, or cleanup.
  Temporary fixtures created for automated tests can manage their own baselines.
- Filtered operations must preserve unrelated baselines. Approval must use a
  completed comparison's selection and validate sources before changing files.
- Preserve reports and history when visual differences produce a failing exit
  status. A failed capture must not become an approvable partial run.
- Consider interrupted writes and overlapping runs for filesystem changes.
  Do not commit generated screenshots, reports, cookies with sensitive values,
  credentials, or private project data.
- When working in a downstream project, read its own instructions and use its
  required runtime or container tooling. Keep Eaglediff fixes distinct from
  project-specific configuration changes.

## Handoff

State what changed and why, the commands run and their results, and any remaining
risks or manual verification. Distinguish verified behavior from assumptions.
Present the completed diff for human review and request commit confirmation only
when the changes are ready to review. Until confirmation arrives, stop before
committing.
