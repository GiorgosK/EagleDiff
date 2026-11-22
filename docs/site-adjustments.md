# Hooks and site adjustments

Eaglediff prepares each page with hooks before taking the screenshot. Most sites
need no changes; the sections below explain the defaults and the settings for
sites that do.

## Default Hooks

Hooks prepare pages before capture. `onBeforeScript` runs before navigation;
`onReadyScript` runs afterward. The default lists are shown together below.
When removing a hook, remove each occurrence. `config-update` adds missing
default hooks back; use a documented disabling setting to keep a feature off.

```json
{
  "onBeforeScript": [
    "hooks/wait-for-drupal-ready",
    "hooks/handle-cookie-consent",
    "hooks/hide-dynamic-elements",
    "hooks/disable-animations",
    "hooks/apply-css-overrides"
  ],
  "onReadyScript": [
    "hooks/wait-for-browser-verification",
    "hooks/fail-on-response-status",
    "hooks/handle-cookie-consent",
    "hooks/wait-for-element",
    "hooks/wait-until-gone",
    "hooks/scroll-to-bottom",
    "hooks/hide-dynamic-elements",
    "hooks/disable-animations",
    "hooks/wait-for-fonts",
    "hooks/pause-media",
    "hooks/load-lazy-images",
    "hooks/wait-for-jquery-ready",
    "hooks/wait-for-drupal-ready",
    "hooks/normalize-responsive-images",
    "hooks/replace-random-content",
    "hooks/apply-css-overrides",
    "hooks/normalize-image-decoding",
    "hooks/wait-for-stable-content",
    "hooks/keep-selectors",
    "hooks/wait-for-background-images",
    "hooks/wait-for-network-idle",
    "hooks/stabilize-carousels",
    "hooks/freeze-web-animations",
    "hooks/stabilize-svg-animations",
    "hooks/prepare-iframes"
  ]
}
```

Hooks generally follow list order. Eaglediff defers iframe and SVG preparation
and selector clipping until after page edits, with a final font check before clipping.
The CSS hooks apply styles before navigation and again before capture.

## Automatic carousel detection

`carouselSelectors: null` detects Swiper, Slick, Owl Carousel, Bootstrap Carousel,
Fotorama, Flickity, FlexSlider, and Unite Gallery. It pauses supported carousels,
and selects their first slide; the final image checks cover the images this
reveals. Custom galleries or
unsupported versions may need a project hook.

Use a selector list to restrict detection, or `[]` to disable it. Config updates
preserve existing `[]`; change it to `null` to enable automatic detection.
`carouselSettleDelayMs` defaults to `500`.

The image-decoding hook also freezes GIF `<img>` elements at their first frame.
CSS background GIFs and iframe images are excluded. If cross-origin conversion
is blocked, a working original is kept with a warning and may still animate.
Use `normalizeImageDecodingSelectors: []` to disable conversion.

## `waitUntilGone`, `carouselSelectors`, and `keepSelectors`

Example scenario: wait for a loader, reset a carousel, then capture the main area.

```json
{
  "url": "/gallery",
  "waitUntilGone": [".loading-overlay"],
  "carouselSelectors": [".gallery.swiper"],
  "keepSelectors": ["main"]
}
```

Use your site's selectors. Empty lists disable these settings; carousel detection
is automatic by default.

## `randomImage` and `randomContent`

Example scenario:

```json
{
  "url": "/news",
  "randomImage": [".news-card img"],
  "randomContent": [".news-card .summary"]
}
```

For varying image sizes, an image entry can be
`{ "selector": ".banner img", "width": 1200, "height": 675 }`.
Both dimensions are required together; they set the placeholder's intrinsic size.
A text entry can use `{ "selector": ".summary", "text": "Fixed summary" }`.

## Google Maps and other third-party embeds

Example: exclude a changing Google Maps embed during calibration. Add to your
existing `hideSelectors` in `defaults` or a scenario:

```json
"hideSelectors": [
  "iframe[src^=\"https://www.google.com/maps/embed\"]"
]
```

The map becomes blank, keeping its layout space. This uses built-in capture
handling; no extra hook is needed. Adjust the selector for your embed URL.
Use this when testing the surrounding page, since map content is no longer compared.
Avoid `removeSelectors` here: removing the iframe shifts the content below it.

The default config already hides the Google Maps selector above and Google My
Maps embeds (`https://www.google.com/maps/d/embed`). Existing configs keep their
saved `hideSelectors`; add the My Maps selector there if needed. For a changing
reCAPTCHA badge, add `.grecaptcha-badge`. Review the resulting captures before
replacing references; excluded embed content is no longer compared.

### Known noisy embeds

These embeds often render differently between runs. None is hidden by default
except the ad slots and Google Maps iframes above; copy the selectors you need
into `hideSelectors` (keeps layout space) and adjust them to your markup.

| Embed | Selectors |
| --- | --- |
| Google Maps JavaScript API maps | `.gm-style` |
| reCAPTCHA badge | `.grecaptcha-badge` |
| Instagram posts | `.instagram-media`, `iframe[src*="instagram.com"]` |
| Facebook page/post plugins | `.fb-page`, `.fb-post`, `iframe[src*="facebook.com/plugins"]` |
| X (Twitter) posts and timelines | `.twitter-tweet`, `.twitter-timeline`, `iframe[src*="platform.twitter.com"]` |
| TikTok videos | `.tiktok-embed` |

YouTube and Vimeo players are already replaced by `pause-media` (see
[Changing videos and social feeds](#changing-videos-and-social-feeds)); cookie
banners are handled by `cookieConsent` (see [Cookie banners](#cookie-banners)).
Chat widgets and other fixed overlays vary by provider: hide their container.

## `replaceContent`

Add to `defaults` or a scenario:

```json
"replaceContent": {
  ".open-hours": "This content"
}
```

Replaces children with plain text, keeping the matched element and its attributes.
Missing matches are ignored; `""` clears content. A scenario's `{}` disables
inherited replacements. When both match, `replaceContent` runs after `randomContent`.

## `cssOverrides`

Add CSS to `defaults` or a scenario. For example:

```json
"cssOverrides": ".banner { background-image: url('/images/fixed-background.jpg') !important; }"
```

Use an image available on the site. Scenario CSS replaces the default CSS;
`""` disables it for that scenario. Hiding a CAPTCHA or other changing element
excludes it from comparison; review its replacement before updating references.

## Moving content

The `freeze-web-animations` hook pauses time-based browser animations at their
first frame, including scrolling strips. It handles JavaScript Web Animations
and CSS animations that override the `disable-animations` rules, including
animations started or replayed later.

Set `"freezeWebAnimations": false` in `defaults` or a scenario, or remove
`hooks/freeze-web-animations`, to disable it. Pausing can hide entrance content
or hold animation-finished callbacks; disable this hook when that is unsuitable.
Animations driven by timers, direct style updates, scrolling, or iframe players
may need a custom hook. Browser timers and animation-frame callbacks keep running.

The `stabilize-svg-animations` hook also stops recognized SVGator players and
native SVG (SMIL) animations, including SVG documents loaded through `<object>` or
`<embed>`. Set `"stabilizeSVGAnimations": false` or remove the hook to disable it.
Unknown scripted SVG players may need a project hook.

## Cookie banners

Cookie banners are hidden by default, without accepting cookies. Recognized
banners include OneTrust, Cookiebot, European Commission Webtools (Europa),
CookieScript, Didomi, Automattic/A8C,
and the `cookie-consent` component used by Opera
(not every custom version is supported).

Set this in `defaults` or an individual scenario:

```json
"cookieConsent": "hide"
```

- `"hide"`: hide recognized banners and overlays without granting consent.
- `"accept"`: click a recognized accept-all button and wait for the banner to close.
- `"leave"`: leave recognized banners unchanged and do not click them.

Acceptance may load extra tracking, images, or embeds. It runs before the other
page-readiness checks. `cookieConsentTimeout` bounds the wait (default `3000`
milliseconds). No recognized banner means no action; a recognized banner that
cannot be accepted stops capture. Custom, iframe, or shadow-root banners may need
a project hook. Explicit custom hide rules still apply in every mode.
`cookieConsent` controls all supported providers. Empty `hideDynamicSelectors`
opt-outs are preserved; set `cookieConsent` explicitly to override them.
Survey invitations are separate from cookie banners. Hide their specific
containers with `cssOverrides` when they should be excluded from comparisons.

## Changing videos and social feeds

The default `pause-media` hook replaces native HTML videos and recognized
YouTube/Vimeo iframe players with neutral gray placeholders. This includes
YouTube's privacy-enhanced embeds and lazy iframe URLs in `data-src` or
`data-lazy-src`. It also pauses audio and blocks later playback.

Explicit CSS and HTML sizes are preserved. Auto-sized native placeholders use
the browser's empty video sizing, so metadata or poster loading cannot change
the captured layout. Use a CSS aspect ratio when a particular video shape matters.
Existing references with auto-sized videos may need review.

Set `"videoCaptureMode": "first-frame"` in `defaults` or an individual scenario
to capture native videos paused at their first frame instead (up to 15 seconds
to load). Remove `hooks/pause-media` from `onReadyScript` to disable both modes.
Existing references containing video frames need review before replacement.

`"first-frame"` works only with native HTML videos (`<video>`). YouTube and
Vimeo embeds have their own playback controls and loading behavior, so this mode
leaves them unchanged; use `"placeholder"` for consistent captures of those players.
Other video providers, custom player wrappers, and changing social feeds may need
a selector or custom hook.
Placeholders are applied after initial navigation; navigation timeouts still apply.

To replace changing video tiles with plain placeholders, target the wrapper
around each video and its controls. For example, if it has class `.video-tile`:

```json
{
  "url": "/gallery",
  "hideSelectors": [".video-tile *"],
  "cssOverrides": ".video-tile { background: #e2e5e8 !important; }"
}
```

Replace `.video-tile` with your site's selector. The contents become invisible,
keeping their layout space, while the wrapper shows a grey background. This
checks the tile layout and surrounding page, excluding the video content.
Review the placeholders before updating references.

## Web fonts

`wait-for-fonts` checks requested web fonts and repeats before capture.
Use `requiredFonts` to also require specific declared fonts, such as
`["400 16px Inter"]`. Failed downloads stop capture; `fontTimeout` controls the wait.
Unavailable aliases that only reference local system fonts are allowed, since
the browser can fall back to another font. Explicit `requiredFonts` checks remain
strict, including for local aliases. If the browser cannot inspect a failed
font's source, it remains an error.
Waiting for fonts does not rerun a site's cached layout calculations. A project
hook may be needed if the page calculates dimensions before its fonts load.

## Network idle

`networkIdleTime` is the continuous quiet period to look for; `networkIdleTimeout`
is the maximum time to spend looking. With the defaults, the hook looks for
500 ms without active requests and gives up after 5 seconds. It continues when
that limit expires; it does not wait another 5 seconds after the network settles.

The wait starts when `wait-for-network-idle` is reached in `onReadyScript`, after
most image/font preparation. Carousel, animation, iframe and final resource checks
can still run afterward. It does not extend earlier waits, such as browser
verification, or prove that application content has finished updating. Use a
ready selector or stable-content check for specific page content.

## Automatic browser verification

For an automatic verification page, `browserVerification.challengeSelectors`
should identify its HTML container. The default matches a BotBuster script;
configure other verification pages using their own HTML structure.
Once detected, the hook remembers the visible elements on that screen in memory.
It continues when the matching structure disappears, or those original elements
are removed and replaced with page content while only non-visible markers, such
as script tags, remain. Text changes and spinner animations do not count as
completion. No HTML snapshot is saved to disk.

The cleared screen must settle for `settleDelayMs` (default 500 ms), with the
document no longer loading. Redirects or a reappearing challenge restart that
settling period. If a site keeps and reuses the same screen container, configure
its verification container selector for a more precise check.

For example, using the verification page's actual container selector:

```json
"browserVerification": {
  "challengeSelectors": [".verification-screen"],
  "timeout": 60000,
  "settleDelayMs": 500
}
```

The timeout is one total budget, not a separate allowance for each redirect.
Pages without detected verification skip the settling wait. A visible configured
error or an unfinished verification stops capture; timeout messages show whether
the structure was detected or the document was still loading. These failures are
not automatically retried. Known CDN challenge detection still stops capture,
as described under [CDN or security verification pages](troubleshooting.md#cdn-or-security-verification-pages).

Repeated requests may trigger protection, but a timeout alone does not prove
that. Use filtered runs or fewer workers to reduce traffic while investigating,
or ask the site's administrator about approved test access. Eaglediff does not
solve CAPTCHAs or bypass verification.

## jQuery and Drupal startup

`wait-for-jquery-ready` waits for jQuery startup callbacks, including startup
holds. `wait-for-drupal-ready` separately checks that registered Drupal startup
behaviors were attached to the document. Both skip when their library is absent.

Use `waitForJQueryReady: false` or `waitForDrupalReady: false` to disable a check.
`jqueryReadyTimeout` and `drupalReadyTimeout` bound their waits. Timeouts fail
capture and can retry; the hooks do not force initialization or hide menus.
Drupal sites that intentionally defer behaviors or initialize only selected
components may need to disable its check. It watches the main page, not iframes.

A Drupal timeout means Eaglediff could not confirm attachment, not necessarily
that the page is broken. The error reports whether it observed whole-page
startup before finding pending behaviors, or never observed startup. Temporary
failures already get one fresh-page retry by default. A longer timeout helps
slow startup, but cannot fix scripts that never initialize. Eaglediff does not
rerun Drupal initialization because that can duplicate page actions.

## Waiting for page content

Library readiness cannot predict later application updates. For a form that
loads asynchronously, use a specific signal:

```json
{
  "url": "/newsletter",
  "readySelector": ".newsletter-form button[type=submit]",
  "readyVisible": true,
  "readyTimeout": 15000
}
```

If it loads only after scrolling, put `wait-for-element` after `scroll-to-bottom`.
Similarly, put image loading before a selector wait that depends on image loading
or the page's load event. `scrollTimeout` bounds scrolling, including pages whose
height keeps growing.

## Lazy images

`load-lazy-images` loads common `data-src`, `data-srcset`, and `data-sizes`
attributes, including `data-lazy-*`, then waits for image decoding.
Lazy attributes are kept during the initial scroll so the site's own loader can
finish layout initialization, then cleaned up. Native source choices are preserved.
When `scroll-to-bottom` has already run for the capture, the hook does not scroll
the page again; without it (or if it is listed later), the hook scrolls itself.
If a source changes during decoding, the hook makes up to two additional decode
attempts within the same timeout. Broken images still follow `imageFailurePolicy`.
CSS background images are checked separately. CSS-hidden backgrounds are skipped; visible
backgrounds below the fold are still checked. Newly introduced image sources
are rechecked.

`imageFailurePolicy` defaults to `"error"`. `"warn"` allows broken images with
warnings, so their placeholders can still cause visual differences. Stalled
downloads fail in either mode and can use temporary retries.

Images inside `display: none` subtrees are skipped, including unused lazy sources.
They are checked again if a later hook reveals them. Offscreen images, transparent
images, and images hidden with `visibility` still load because they can affect
layout. Hidden empty `data:,` placeholders are also ignored. Visible broken images
still fail capture.

If an unimportant image repeatedly fails, hide it before image checks with a
scenario's `cssOverrides`. Use the image's actual CSS selector; image failure
messages name the owning element (for example `Element: img#logo.brand`, or
`Element: section#hero.banner (background-image)`) to help find it:

```json
"cssOverrides": "img.optional-image { display: none !important; }"
```

This removes the image and its space from the comparison. Add the rule to any
existing `cssOverrides` rather than replacing those rules.

`removeSelectors` runs after the initial image checks, so it is too late to prevent
image-loading errors. `hideSelectors` also keeps checking images. Use
`cssOverrides` with `display: none` to skip these checks for an unwanted image.

`retryImageDownloads: true` attempts to recover stalled HTTP downloads using the
browser context's cookies. The recovered image must still decode successfully.
`imageDownloadTimeout` limits recovery; it defaults to `15000` milliseconds.

## Scroll reveals, fading icons, and moving decorations

`disable-animations` removes CSS animation delays, but JavaScript can still hide
an element or fade it in. Use `cssOverrides` to show selected content and stop
selected decorations. Replace `.reveal` with your site's selector:

```json
"cssOverrides": ".reveal { visibility: visible !important; opacity: 1 !important; animation: none !important; }",
"waitForStableContent": {
  "triggerSelectors": [],
  "selectors": [".reveal"],
  "timeout": 15000,
  "settleDelayMs": 1000
}
```

## `addParagraph`

Example scenario for checking that a deliberate change is detected:

```json
{
  "url": "/about",
  "addParagraph": true,
  "addParagraphTarget": ".page-content"
}
```

Run `eaglediff test --filter=about --addpara`.

Review captures after changing preparation settings, then update references only
when the new appearance is intended. Existing configs need the corresponding
[default hooks](#default-hooks).
