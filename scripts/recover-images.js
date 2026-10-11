const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');

async function downloadImage(page, source, timeout) {
  const deadline = Date.now() + timeout;
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const session = await page.createCDPSession();
  async function download(url, redirects = 0) {
    const { cookies } = await session.send('Network.getCookies', { urls: [url] });
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Image recovery download timed out.');
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Image recovery requires an HTTP image.');
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': userAgent, Accept: 'image/*,*/*;q=0.8' };
      if (cookies.length) headers.Cookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      const referrer = new URL(page.url());
      referrer.hash = ''; referrer.username = ''; referrer.password = '';
      if (target.protocol === 'https:' || referrer.protocol === 'http:') {
        headers.Referer = target.origin === referrer.origin ? referrer.href : referrer.origin + '/';
      }
      // Match the runner's existing Chrome certificate handling for local DDEV.
      const request = (target.protocol === 'https:' ? https : http).get(target, {
        headers, rejectUnauthorized: false
      }, response => {
        const status = response.statusCode;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume(); clearTimeout(timer);
          if (redirects >= 5) return reject(new Error('Too many image recovery redirects.'));
          download(new URL(response.headers.location, target).href, redirects + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 50 * 1024 * 1024) {
            request.destroy(new Error('Image recovery response exceeds 50 MiB.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', error => { clearTimeout(timer); reject(error); });
        response.on('end', () => {
          clearTimeout(timer);
          if (status !== 200 || !/^image\//i.test(response.headers['content-type'] || '')) {
            return reject(new Error(`Image recovery expected an image response; HTTP ${status}.`));
          }
          try {
            let body = Buffer.concat(chunks);
            const encoding = response.headers['content-encoding'];
            const options = { maxOutputLength: 50 * 1024 * 1024 };
            if (encoding === 'gzip') body = zlib.gunzipSync(body, options);
            else if (encoding === 'br') body = zlib.brotliDecompressSync(body, options);
            else if (encoding === 'deflate') body = zlib.inflateSync(body, options);
            else if (encoding && encoding !== 'identity') throw new Error('Unsupported image recovery encoding.');
            const responseHeaders = { ...response.headers };
            for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) delete responseHeaders[key];
            resolve({ status: 200, headers: responseHeaders, body });
          } catch (error) { reject(error); }
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('Image recovery download timed out.')), remaining);
      request.on('error', error => { clearTimeout(timer); reject(error); });
    });
  }
  try { return await download(source); }
  finally { await session.detach().catch(() => {}); }
}

module.exports = async function recoverImages(page, failures, timeout) {
  const responses = new Map();
  const requestUrl = source => { const url = new URL(source); url.hash = ''; return url.href; };
  for (const failure of failures) {
    const source = failure.sources[0];
    const key = requestUrl(source);
    if (!responses.has(key)) responses.set(key, await downloadImage(page, source, timeout));
  }
  // Serve the recovered bytes at their original URL, preserving the image's
  // origin and the subsequent JPEG normalization instead of substituting a blob.
  await page.setRequestInterception(true);
  const onRequest = async request => {
    if (request.isInterceptResolutionHandled()) return;
    const response = responses.get(requestUrl(request.url()));
    try {
      if (response) await request.respond(response, 1);
      else await request.continue({}, 0);
    } catch (error) {
      if (!page.isClosed() && !request.isInterceptResolutionHandled()) {
        await request.continue({}, 0).catch(() => {});
      }
    }
  };
  page.on('request', onRequest);
  page.once('close', () => page.off('request', onRequest));
  await page.setCacheEnabled(false);
  const sources = failures.map(failure => failure.sources[0]);
  try {
    await page.evaluate(async (currentSources, timeoutMs) => {
      const images = [...document.images].filter(image => currentSources.includes(image.currentSrc || image.src));
      const selected = images.map(image => [image, image.currentSrc || image.src]);
      for (const [image] of selected) {
        image.closest('picture')?.querySelectorAll('source').forEach(source => source.removeAttribute('srcset'));
        image.removeAttribute('srcset'); image.removeAttribute('sizes');
        image.removeAttribute('src');
      }
      // Let Chrome cancel the stalled request before requesting the same source.
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.all(selected.map(async ([image, source]) => {
        image.loading = 'eager'; image.src = source;
        let timer;
        try {
          await Promise.race([image.decode(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Recovered image did not decode before capture.')), timeoutMs);
          })]);
        } finally { clearTimeout(timer); }
      }));
    }, sources, timeout);
  } finally {
    await page.setCacheEnabled(true).catch(() => {});
  }
};
