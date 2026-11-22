# Coming from BackstopJS

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

## Import From Backstop

```bash
eaglediff import --backstop=/path/to/tests/backstop/backstop.json
```

Import derives base URLs, scenarios, and supported settings. It converts
`asyncCaptureLimit` to `core.workers` unless workers are already set in Eaglediff.
Cookie file paths are made relative to `config.json`; import warns about cookie
files that do not exist (often never committed). Custom Backstop scripts
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
logged. Each capture uses an isolated browser context. Cookie files are read
once before the browser starts; a missing or invalid file stops the run there.

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
