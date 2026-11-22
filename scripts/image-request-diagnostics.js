// Record only status, content type, and network failure; never bodies or cookies.
module.exports = function trackImageRequests(page) {
  const requests = new Map();
  const sources = request => [...request.redirectChain(), request].map(entry => entry.url());
  const onResponse = response => {
    const request = response.request();
    if (request.resourceType() !== 'image') return;
    const headers = response.headers();
    const details = {
      status: response.status(),
      type: (headers['content-type'] || 'unknown content type').replace(/[\r\n]/g, ' ').slice(0, 160),
      // A web server can serve an image file while another request is still
      // writing it (for example a new Drupal image style derivative).
      empty: headers['content-length'] === '0'
    };
    for (const source of sources(request)) requests.set(source, details);
  };
  const onFailure = request => {
    if (request.resourceType() !== 'image') return;
    for (const source of sources(request)) {
      requests.set(source, { ...requests.get(source), failure: request.failure()?.errorText });
    }
  };
  page.on('response', onResponse);
  page.on('requestfailed', onFailure);
  return {
    explain(error) {
      const lines = new Set();
      for (const [source, details] of requests) {
        if (!error.message.includes(source)) continue;
        if (details.status) lines.add(`Image response: HTTP ${details.status} (${details.type}${details.empty ? ', empty body' : ''}).`);
        if (details.failure) lines.add(`Image network error: ${details.failure}.`);
      }
      return [...lines].join('\n');
    },
    dispose() {
      page.off('response', onResponse);
      page.off('requestfailed', onFailure);
      requests.clear();
    }
  };
};
