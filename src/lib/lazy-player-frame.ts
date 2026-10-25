import type { VideoSource, VideoProvider } from './providers/video/types';

/** Observes only our container. Never accesses provider DOM or reports load as playback. */
export function lazyPlayerFrame(
  host: HTMLElement,
  source: VideoSource,
  policy: VideoProvider['iframePolicy'],
  callbacks: { loaded: () => void; failed: (timeout: boolean) => void },
) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const skeleton = document.createElement('div');
  skeleton.className = 'player-skeleton';
  skeleton.setAttribute('aria-label', 'Подготовка плеера');
  host.replaceChildren(skeleton);
  const observer = new IntersectionObserver(
    (entries) => {
      if (disposed || !entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const frame = document.createElement('iframe');
      frame.src = source.embedUrl!;
      frame.title = `${source.providerName} · серия ${source.episodeNumber}`;
      frame.allow = policy?.allow || "autoplay 'none'; fullscreen; picture-in-picture";
      frame.referrerPolicy = policy?.referrerPolicy || 'strict-origin-when-cross-origin';
      if (policy?.sandbox !== null)
        frame.setAttribute(
          'sandbox',
          policy?.sandbox || 'allow-scripts allow-same-origin allow-presentation',
        );
      frame.allowFullscreen = true;
      frame.onload = () => {
        if (!disposed) {
          clearTimeout(timer);
          skeleton.remove();
          callbacks.loaded();
        }
      };
      frame.onerror = () => {
        if (!disposed) {
          clearTimeout(timer);
          callbacks.failed(false);
        }
      };
      // Paint the loading surface behind the iframe, never over provider controls or ads.
      host.replaceChildren(skeleton, frame);
      timer = setTimeout(() => {
        if (!disposed) callbacks.failed(true);
      }, 20000);
    },
    { rootMargin: '320px 0px' },
  );
  observer.observe(host);
  return () => {
    disposed = true;
    observer.disconnect();
    clearTimeout(timer);
    host.replaceChildren();
  };
}
