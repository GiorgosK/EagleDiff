# Contributing

Follow [AGENTS.md](../AGENTS.md) for development and commit-review requirements.

From the Eaglediff checkout, with [prerequisites](installation.md#prerequisites) installed, use
the Node version in `.nvmrc` (`nvm use` if using nvm):

```sh
pnpm install --frozen-lockfile

# Focused tests while developing
node --test tests/lazy-images.test.js

# Fast safety checks during development
pnpm run test:fast

# Complete automated suite when preparing requested commits (after confirmation)
pnpm run test:unit
git diff --check

# Investigate coverage when needed
pnpm run test:coverage
```

`pnpm test` runs a project's visual comparison; `test:unit` tests Eaglediff itself.
The automated suite uses local fixtures and temporary directories, with at most
four test files in parallel. It needs no production website or project config.
The fast selection is listed in `tests/fast-tests.json`. It checks shared safety
rules such as preserving references; also run the tests for the area you change.

GitHub Actions runs the complete suite on every push and pull request
([.github/workflows/test.yml](../.github/workflows/test.yml)), on Ubuntu with
the Node version in `.nvmrc` and the runner's Google Chrome. A second job packs
Eaglediff as npm would publish it, installs it globally and into a project, and
runs a real `reference`, `calibrate` and `test`
([.github/package-smoke.sh](../.github/package-smoke.sh)); run that script
locally before a release.

Add regression tests for changed behavior, overrides, failures, and cleanup.
Assert resulting screenshots, reports, exit codes, or saved files. Code running
inside Chromium needs browser assertions; Node coverage alone cannot measure it.

See [Architecture](architecture.md) for architecture and implementation details.

## AI-assisted development

Parts of Eaglediff's code, tests, and documentation were developed with
assistance from AI coding tools, including OpenAI Codex and Anthropic's Claude
Code. Maintainers direct the
project and remain responsible for technical decisions, reviewing contributions,
and validating behavior. AI-assisted contributions are subject to the same
review and testing standards as other contributions.
