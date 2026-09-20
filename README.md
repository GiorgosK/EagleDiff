# reg-suit-runner

Shared helper for project-specific visual regression runs.

## CLI Arguments

- `--dir` is the project directory the helper should read from and write to.
- `--script-dir` points at the shared helper package directory if you need to override the default.
- Relative `--dir` paths are resolved from the directory you ran the command from.

## Install And Alias

The simplest way to get a short command is to expose the binary as `rsr`.
This package already ships both `reg-suit-runner` and `rsr` binaries.

Example global install:

```bash
pnpm add -g /home/giorgos/share/gwebsites/reg-suit-runner
```

After that, if your global bin directory is on `PATH`, you can run:

```bash
rsr --dir /path/to/your-local-project/tests/reg-suit-runner test -- --filter=homepage
```

If you prefer `/usr/local/bin`, create a symlink to the installed binary:

```bash
sudo ln -s /home/giorgos/share/gwebsites/reg-suit-runner/bin/reg-suit.js /usr/local/bin/rsr
```

## Local Project Usage

Run from your local project root:

```bash
rsr --dir tests/reg-suit-runner test -- --filter=homepage
```

The helper reads the project config from `tests/reg-suit-runner`, writes `.reg/`
state there, and keeps the shared helper package itself free of project data.

## Backstop Import

If you already have a Backstop folder, import it into a project config without
supplying separate reference or test URLs:

```bash
rsr import --backstop=/path/to/your-local-project/tests/backstop --dir tests/reg-suit-runner
```

The importer reads `backstop.json`, derives the base URLs from the scenarios,
and writes `config.json` in the project directory you passed with `--dir`.

## Project Setup

Refresh the project config with the shared helper:

```bash
rsr --dir tests/reg-suit-runner config -- --limit=15 --ref=https://your-local-project.example --test=https://your-local-project.test
```

You can also point the helper at this directory with `REG_SUIT_DIR`:

```bash
export REG_SUIT_DIR=/path/to/your-local-project/tests/reg-suit-runner
rsr --dir tests/reg-suit-runner test
```

Generated screenshots, `.reg/` state, and `results.json` all stay in this
project folder so the helper remains reusable across projects.

If you are starting from Backstop, run the `import` command first and then use
`config` later when you want to refresh or expand the discovered pages.

The shared helper keeps the base template in
`/home/giorgos/share/gwebsites/reg-suit-runner/config-default.json`, so this
project directory does not need its own `config-default.json`.

## Shared Template

The base template config lives in:

```bash
/home/giorgos/share/gwebsites/reg-suit-runner/config-default.json
```

Projects do not need their own `config-default.json`.

## Common Commands

```bash
rsr import --backstop=/path/to/your-local-project/tests/backstop --dir tests/reg-suit-runner
rsr --dir tests/reg-suit-runner reference
rsr --dir tests/reg-suit-runner test
rsr --dir tests/reg-suit-runner approve
```

Common flags:

- `--filter` matches scenario labels or URLs.
- `--addpara` enables the paragraph hook for scenarios that opt in.
- `--clean` starts from a fresh `.reg/actual/` cache.
- `--no-clean` keeps the current `.reg/actual/` cache.
- `--workers` splits capture across multiple Node workers.

## Config Refresh

Refresh or create a config by scanning reference and test URLs:

```bash
rsr --dir tests/reg-suit-runner config -- --limit=15 --ref=https://your-local-project.example --test=https://your-local-project.test
```

Use `config` when you want the helper to discover new pages from the live site
and merge them into the existing config.

Use `--script-dir` only if you need to point the command at a different copy of the helper package than the one that provided the `rsr` binary.

## Browser Verification

`hooks/wait-for-browser-verification` runs before
`hooks/fail-on-response-status`. Challenge detection is configured entirely
through CSS selectors, so the same hook can wait for different verification
scripts or challenge containers. New configs include Botbuster's selectors:

```json
"browserVerification": {
  "challengeSelectors": ["script[src*=\"/botbuster/js/challenge.js\"]"],
  "errorSelectors": ["#error"],
  "timeout": 30000
}
```

Put this object under `defaults`, or override its fields in a scenario's
`browserVerification` object. For another provider, change the selectors, for
example to `script[src*="/other-provider/verify.js"]`. Multiple challenge
selectors match any configured provider. Selectors can be strings or arrays.
`challengeSelectors: []` disables the hook; `errorSelectors: []` disables early
failure detection but retains the timeout.

Choose challenge markers that disappear when verification finishes, usually
when the browser reloads. A script that remains on the final page is not a
suitable marker; use its temporary challenge container instead. A visible
configured error element fails the capture while the challenge is present.
Failed or looping challenges time out with a verification error. This hook
waits for normal browser verification; it does not solve interactive CAPTCHAs.

RSR tracks main-document responses across reloads so the status guard checks
the resulting page, not the challenge's initial 503. Ordinary 503 pages and
error responses after verification still fail. Do not remove 503 from
`failOnResponseStatusCodes` to work around Botbuster. No cookies are forged and
no site protection settings need changing.

Existing projects can add `hooks/wait-for-browser-verification` immediately
before the status guard, together with `defaults.browserVerification`.
Pages without a configured challenge marker pass through. There are no
provider-specific selectors hardcoded in the hook.

## Image Capture Stability

New project configs include three capture/comparison defaults:

- `hooks/wait-for-element` runs before `hooks/wait-until-gone`. The ready
  selector must identify the real page, so a preloader check does not finish
  prematurely on an intermediate browser-verification page.
- `hooks/normalize-image-decoding` follows responsive-image normalization.
  It decodes JPEGs at their intrinsic resolution and displays lossless PNG
  copies during capture, preserving dimensions and content. Site files and
  application configuration are never modified.
- `core.thresholdRateColor: 0.05` tolerates small per-pixel colour differences
  from image decoding or compression. This is distinct from
  `core.thresholdRate: 0.001`, the overall fraction of differing pixels allowed in a
  screenshot. Higher matching thresholds reduce sensitivity to subtle real
  colour changes too; use `0` for strict colour comparison. Values must be
  numbers between `0` and `1`.

Normalization adds processing and memory overhead. Use
`defaults.normalizeImageDecodingSelectors` (or the scenario override) to limit
the selected images; the default is `["img"]`, and `[]` disables it. Image URLs
must end in `.jpg` or `.jpeg` (optionally followed by a query/fragment).
Cross-origin images whose bytes cannot be fetched are left unchanged with a
warning. Other fetch/decode errors fail the capture. PNGs and animated formats
are not converted. Images are not hidden or replaced with placeholders.

Existing configs retain their hook lists and use strict per-pixel matching when
`thresholdRateColor` is absent. To adopt these defaults, update their hook
order, add the decoding hook, and set `core.thresholdRateColor` explicitly.
Use the same settings for reference and test captures and review refreshed
references. Small compression differences can be tolerated, but genuinely
different image content should still produce a diff.

Use `thresholdRate` and `thresholdRateColor` in RSR configs; no legacy
aliases are supported. RSR translates the colour setting to reg-suit's required
internal field name when generating its comparison config.

Run the browser/config/comparison regression checks with
`node --test tests/*.test.js` (requires Chrome/Chromium).
