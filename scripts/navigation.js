// Keep navigation evidence before closing the failed page or stopping workers.
function diagnosticUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'unknown URL';
  }
}

async function navigate(page, url, { waitUntil, timeout }) {
  const started = Date.now();
  const pending = new Map();
  const failures = [];
  const responses = [];
  let domLoaded = false;
  let loaded = false;
  const onRequest = request => pending.set(request, Date.now());
  const onFinished = request => pending.delete(request);
  const onFailed = request => {
    pending.delete(request);
    failures.push(`${request.resourceType()} ${diagnosticUrl(request.url())}: ${request.failure()?.errorText || 'failed'}`);
    if (failures.length > 5) failures.shift();
  };
  const onResponse = response => {
    const request = response.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    responses.push(`${response.status()} ${diagnosticUrl(response.url())}`);
    if (responses.length > 5) responses.shift();
  };
  const onDomLoaded = () => { domLoaded = true; };
  const onLoaded = () => { loaded = true; };
  const listeners = { request: onRequest, requestfinished: onFinished, requestfailed: onFailed,
    response: onResponse, domcontentloaded: onDomLoaded, load: onLoaded };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  try {
    return await page.goto(url, { waitUntil, timeout });
  } catch (error) {
    const lines = [
      error.message,
      `Phase: navigation; waitUntil=${JSON.stringify(waitUntil)}; timeout=${timeout}ms; elapsed=${Date.now() - started}ms`,
      `Navigation responses: ${responses.join(' -> ') || 'none received'}`,
      `Lifecycle: DOMContentLoaded=${domLoaded}; load=${loaded}`,
      `Pending requests: ${pending.size}`,
      ...[...pending.entries()].slice(0, 8).map(([request, since]) =>
        `  ${request.resourceType()} ${diagnosticUrl(request.url())} (${Date.now() - since}ms)`),
      ...(pending.size > 8 ? [`  ... ${pending.size - 8} more`] : []),
      ...(failures.length ? ['Recent failed requests:', ...failures.map(failure => `  ${failure}`)] : []),
      'Adjust defaults.navigationTimeout (or scenario.navigationTimeout) for slow navigation. Try --workers=1 to check concurrency; core.protocolTimeout is a separate browser-command timeout.'
    ];
    const failure = new Error(lines.join('\n'), { cause: error });
    if (error.name === 'TimeoutError') failure.code = 'RSR_NAVIGATION_TIMEOUT';
    throw failure;
  } finally {
    for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
  }
}

module.exports = { navigate };
