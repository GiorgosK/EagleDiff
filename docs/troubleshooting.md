# Troubleshooting

## Capture Errors

Terminals show `ERROR:` in red and `Warning:` in orange; logs use plain text.
Capture failures identify the page, viewport, hook, and available resource/network details.
In `test` and `calibrate`, a failed capture does not stop the run: the other
pages are still captured and compared, and the report shows them (the failed
page appears as deleted). The command then fails, lists every capture error,
and the run cannot be approved. After 10 failed captures the run stops, since
the site is probably down. In `reference`, the first failure stops the run and
the references stay unchanged. Progress lines mean a capture started, not that
its screenshot was saved.

To investigate one page:

```bash
eaglediff reference --filter=problem-page --workers=1
```

This replaces matching references if successful. Navigation errors include
redirects and pending requests. Adjust `navigationTimeout` for slow navigation;
`core.protocolTimeout` is a separate browser-command timeout.

### Blank or incomplete iframe screenshots

The default `prepare-iframes` hook waits for visible iframe documents and uses
`captureBeyondViewport: "auto"` to improve full-page iframe rendering. Nested
frames are included; hidden and one-pixel tracking frames are ignored.

Set `captureBeyondViewport: false` to always expand the viewport for full-page
capture, or `true` to keep its layout size unchanged. Expanding can affect
height-dependent layouts. Try `false` if full-page captures contain partially
painted images. `waitForIframes: false` disables the document wait;
removing the hook also disables automatic viewport adjustment. Selector clipping
keeps its existing capture mode. Content loaded later may need a custom hook.

## Capture messages and logs

Capture warnings, retries and errors show a short summary in the terminal.
Page URLs stay complete at the start of warnings/retries and in final errors.
The `Details:` path points to a separate `.reg/logs/*.log` file for that run,
with full messages, page URLs, hook names and error stacks. Logs also keep
retries that later succeed and are retained across runs. A clean capture creates
no log. If writing the log fails, full details stay in the terminal.

A warning does not necessarily trigger a retry. A line saying `retrying 1/2`
means the first of two allowed retries is starting; `retrying 2/2` is the last
retry. The Drupal startup check is one source of these failures; retries also
handle supported network, browser and other readiness failures.

## Slow or interrupted captures

`core.temporaryErrorRetries` defaults to `2`: retry a temporary failure up to
twice in fresh browser contexts (three attempts total). Existing configs keep
saved values, including `0` and `1`.
An initial redirect can resume the first page check on the new document. If a
navigation interrupts later preparation, the whole capture uses these retries
so its hooks run again before saving a screenshot.
A disconnected worker browser is restarted on retry. Retries do not override
image or HTTP error policies.
An image answered with HTTP 429, 502, 503 or 504, or with an empty body, counts
as temporary and is retried. For example, Drupal answers 503 while it creates a
new image style, and the web server can serve that file while it is still
being written. Other broken images fail immediately.

To finish the initial captures first, then retry temporary failures one at a time,
set this inside the existing `core` object:

```json
"temporaryErrorRetryMode": "deferred"
```

Only the failed page/viewport pairs are retried. `temporaryErrorRetries` still
limits retries per capture; `0` disables them. Deferred retries use fresh browser
contexts and run with one capture at a time, regardless of the initial worker
count. If any remain unsuccessful, the run fails and cannot be approved (see
[Capture Errors](#capture-errors)). Security challenges still stop the run
immediately. This does not retry visual differences.

`core.temporaryErrorRetryTimeoutMultiplier: 2` gives retries longer readiness
budgets: 1×, 2×, then 4×. It does not change workers, delays, or retry count.
Keep `core.protocolTimeout` above the longest resulting readiness budget.

## Known problems and fixes

### Navigation or resource-loading timeouts

Parallel captures can hit timeouts on machines with limited CPU or memory,
slower internet connections, or busy servers. If you see an error such as
`Navigation timeout of 30000 ms exceeded`, try one worker to check whether
loading fewer pages at once avoids it:

```bash
eaglediff reference --workers=1
```

A successful `reference` run replaces references. The same flag works with
`test` and `calibrate`. If fewer workers help, increase the count gradually or
lower `core.workers` in `config.json`. Persistent timeouts may need further
investigation of the page or its resources.

### CDN or security verification pages

Built-in checks detect known challenges from **Cloudflare, AWS WAF, DataDome,
and HUMAN/PerimeterX**, even without readiness hooks. Detection stops `config`,
`reference`, `test`, or `calibrate` with exit code `1`, preserving existing configs
and references. Blocked discovery does not write a partial config. Detection is
not exhaustive; ordinary CAPTCHA widgets or CDN scripts alone do not trigger it.

Use a staging/development environment, or ask the site's administrator about
an exception for authorized test traffic. See
[Cloudflare's exception setup instructions](https://developers.cloudflare.com/waf/custom-rules/skip/).
Eaglediff does not solve or bypass challenges.

### No such file or directory

`env: 'node': No such file or directory`

Node.js is missing or unavailable in this terminal. Check [Prerequisites](installation.md#prerequisites)
to install it and set it up for new terminals. If Node **22.19.0** is already
installed through nvm, activate it temporarily for this terminal:

```bash
nvm use 22.19.0
```

Then retry your Eaglediff command.
