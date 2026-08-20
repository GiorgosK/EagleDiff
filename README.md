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

Refresh or create a config:

```bash
rsr --dir tests/reg-suit-runner config -- --limit=15 --ref=https://your-local-project.example --test=https://your-local-project.test
```

Use `--script-dir` only if you need to point the command at a different copy of the helper package than the one that provided the `rsr` binary.
