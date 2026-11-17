function resolveOptions(config = {}, scenario = {}) {
  const mode = scenario.videoCaptureMode ?? config.defaults?.videoCaptureMode ?? 'placeholder';
  if (!['placeholder', 'first-frame'].includes(mode)) {
    throw new Error('videoCaptureMode must be "placeholder" or "first-frame".');
  }
  return { mode };
}

module.exports = async function pauseMedia(page, context = {}) {
  const { mode } = resolveOptions(context.config, context.scenario);
  const failure = await page.evaluate(async mode => {
    const preserveBox = element => {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height && !element.dataset.eaglediffVideoPlaceholder) {
        // Preserve the used CSS box before removing the source's intrinsic size.
        const style = getComputedStyle(element);
        element.style.setProperty('width', style.width, 'important');
        element.style.setProperty('height', style.height, 'important');
        element.style.setProperty('background', '#e2e5e8', 'important');
        element.dataset.eaglediffVideoPlaceholder = 'true';
      }
    };
    const isVideoEmbed = frame => {
      for (const attribute of ['src', 'data-src', 'data-lazy-src']) {
        const source = frame.getAttribute(attribute);
        if (!source) continue;
        let url;
        try { url = new URL(source, document.baseURI); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        if (['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname) &&
            /^\/embed(?:\/|$)/.test(url.pathname)) return true;
        if (url.hostname === 'player.vimeo.com' && /^\/video\//.test(url.pathname)) return true;
      }
      return false;
    };
    const freeze = media => {
      if (media instanceof HTMLIFrameElement) {
        if (mode !== 'placeholder' || !isVideoEmbed(media)) return;
        preserveBox(media);
        // Keep the iframe element and its layout, but discard the remote player.
        media.removeAttribute('data-src');
        media.removeAttribute('data-lazy-src');
        if (media.getAttribute('src') !== 'about:blank') media.setAttribute('src', 'about:blank');
        // No scripts, stylesheets or remote assets; bgcolor also works in sandboxed
        // frames and under a page policy that forbids inline styles.
        const placeholder = '<body bgcolor="#e2e5e8"></body>';
        if (media.getAttribute('srcdoc') !== placeholder) media.setAttribute('srcdoc', placeholder);
        return;
      }
      if (media.autoplay) media.autoplay = false;
      media.pause();
      if (mode === 'placeholder' && media instanceof HTMLVideoElement) {
        const hadSource = media.hasAttribute('src') || media.srcObject ||
          media.querySelector('source[src]');
        if (media.hasAttribute('src')) media.removeAttribute('src');
        if (media.srcObject) media.srcObject = null;
        media.querySelectorAll('source[src]').forEach(source => source.removeAttribute('src'));
        if (media.hasAttribute('poster')) media.removeAttribute('poster');
        if (media.controls) media.controls = false;
        if (hadSource) media.load();
        // Measure the empty element: metadata/poster timing must not choose an
        // intrinsic size. CSS sizes, aspect ratios and HTML dimensions still apply.
        preserveBox(media);
      } else if (media.readyState >= 1 && Number.isFinite(media.duration) && media.currentTime !== 0) {
        media.currentTime = 0;
      }
    };
    if (!window.__eaglediffMediaGuard) {
      const state = { freeze };
      const guard = event => {
        if (event.target instanceof HTMLMediaElement) state.freeze(event.target);
      };
      for (const event of ['play', 'playing', 'loadedmetadata']) document.addEventListener(event, guard, true);
      const observer = new MutationObserver(records => {
        const changed = new Set();
        for (const record of records) {
          const owner = record.target.closest?.('video,audio,iframe');
          if (owner) changed.add(owner);
          for (const node of record.addedNodes) {
            if (node instanceof HTMLMediaElement || node instanceof HTMLIFrameElement) changed.add(node);
            node.querySelectorAll?.('video,audio,iframe').forEach(media => changed.add(media));
          }
        }
        changed.forEach(media => state.freeze(media));
      });
      observer.observe(document.documentElement, { subtree: true, childList: true,
        attributes: true, attributeFilter: ['src', 'srcdoc', 'data-src', 'data-lazy-src', 'autoplay', 'poster', 'controls'] });
      // Listeners/observer belong to this document and disappear with its context.
      window.__eaglediffMediaGuard = state;
    }
    window.__eaglediffMediaGuard.freeze = freeze;
    const media = [...document.querySelectorAll('video, audio, iframe')];
    const visible = video => {
      const rect = video.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (['hidden', 'collapse'].includes(getComputedStyle(video).visibility)) return false;
      for (let node = video; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.opacity === '0' ||
            (node !== video && style.contentVisibility === 'hidden')) return false;
      }
      return true;
    };
    const videos = mode === 'first-frame' ? media.filter(element => element instanceof HTMLVideoElement && visible(element) &&
      (element.currentSrc || element.getAttribute('src') || element.querySelector('source[src]:not([src=""])'))) : [];
    const frames = new Map();
    for (const video of videos) {
      if (video.requestVideoFrameCallback && (video.currentTime !== 0 || video.seeking || video.readyState < 2)) {
        const state = { ready: false };
        const rendered = (_now, metadata) => {
          // An older frame may already be queued when the seek starts.
          if (metadata.mediaTime <= 0.05) state.ready = true;
          else state.id = video.requestVideoFrameCallback(rendered);
        };
        state.id = video.requestVideoFrameCallback(rendered);
        frames.set(video, state);
      }
    }
    try {
      media.forEach(freeze);
      // preload="none" still needs to produce a decoded first frame.
      for (const video of videos) {
        if (!video.readyState) {
          video.preload = 'auto';
          if ([HTMLMediaElement.NETWORK_EMPTY, HTMLMediaElement.NETWORK_IDLE].includes(video.networkState)) video.load();
        }
      }
      const deadline = performance.now() + 15000;
      while (true) {
        for (const video of videos) {
          if (video.error) return `Cannot prepare video before capture: ${video.currentSrc || video.src}\n${video.error.message || 'Video decoding failed.'}`;
          if (video.readyState >= 1 && !Number.isFinite(video.duration)) {
            return `Cannot freeze live video at its first frame: ${video.currentSrc || video.src}\nUse videoCaptureMode="placeholder".`;
          }
          freeze(video);
        }
        const pending = videos.filter(video => video.readyState < 2 || video.seeking || video.currentTime !== 0 ||
          (frames.has(video) && !frames.get(video).ready));
        if (!pending.length) break;
        if (performance.now() >= deadline) {
          return `Cannot prepare video before capture: ${pending[0].currentSrc || pending[0].src}\nTimed out after 15000ms waiting for its first frame.`;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return null;
    } finally {
      for (const [video, state] of frames) video.cancelVideoFrameCallback(state.id);
    }
  }, mode);
  if (failure) throw new Error(failure);
  // Flush Chromium's video compositor: seeked/decoded callbacks can precede the
  // frame used by screenshots. A tiny discarded capture submits that frame.
  if (mode === 'first-frame') {
    await page.screenshot({ clip: { x: 0, y: 0, width: 1, height: 1 }, captureBeyondViewport: false });
  }
};
module.exports.resolveOptions = resolveOptions;
