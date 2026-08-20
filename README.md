# reg-suit-runner

Shared helper for project-specific visual regression runs.
The runnable code lives here. Each project keeps its own config and generated
artifacts in its own folder.

## Paths

- `--dir` is the pnpm working directory for this helper package.
- `--project-dir` is the target project folder that the helper reads from and
  writes to.
- When `--project-dir` is relative, it is resolved from the directory you ran
  pnpm from.

## Global Setup

Install the helper once:

```bash
pnpm --dir /home/giorgos/share/gwebsites/reg-suit install
```

Run it against a project:

```bash
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir /home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner test -- --filter=homepage
```

Or from the project root:

```bash
cd /home/giorgos/share/gwebsites/my-site
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir tests/reg-suit-runner test -- --filter=homepage
```

You can also set:

```bash
export REG_SUIT_PROJECT_DIR=/home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner
```

The helper reads config from the project directory, writes `.reg/` and
`results.json` there, and leaves the shared helper tree untouched.

The shared template config lives in
`/home/giorgos/share/gwebsites/reg-suit/config-default.json`, so project
directories do not need their own `config-default.json`.

## Project Commands

```bash
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir /home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner reference
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir /home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner test
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir /home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner approve
```

Common flags:

- `--filter` matches the scenario label or URL substring.
- `--addpara` enables the paragraph hook when a scenario opts in.
- `--clean` starts with a fresh `.reg/actual/` cache.
- `--no-clean` keeps the current `.reg/actual/` cache.
- `--workers` splits screenshot capture across multiple Node workers.

## Config

Refresh a project config:

```bash
pnpm --dir /home/giorgos/share/gwebsites/reg-suit run cli -- --project-dir /home/giorgos/share/gwebsites/my-site/tests/reg-suit-runner config -- --limit=15 --ref=https://example.com --test=https://my-site.ddev.site
```

This command preserves the current config when it already exists and only uses
`--ref` / `--test` when a new config is being created.
