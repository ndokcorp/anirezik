import type { VideoSource } from './providers/video/types';
export function initPlayers() {
  document.querySelectorAll<HTMLElement>('[data-player]').forEach((player) => {
    const sources = JSON.parse(
      player.querySelector('[data-video-sources]')?.textContent || '[]',
    ) as VideoSource[];
    const episodes = player.querySelector<HTMLSelectElement>('[data-video-episode]')!;
    const dubs = player.querySelector<HTMLSelectElement>('[data-video-dub]')!;
    const surface = player.querySelector<HTMLElement>('[data-video-surface]')!;
    function populate() {
      dubs.replaceChildren();
      sources.forEach((source, index) => {
        if (source.episodeNumber !== Number(episodes.value)) return;
        const option = new Option(
          `${source.providerName} · ${source.audioLanguage}${source.dubbingStudio ? ' · ' + source.dubbingStudio : ''}${source.subtitles.length ? ' · субтитры: ' + source.subtitles.join(', ') : ''}`,
          String(index),
        );
        dubs.append(option);
      });
      render();
    }
    function render() {
      const source = sources[Number(dubs.value)];
      surface.replaceChildren();
      if (!source) return;
      if (source.embedUrl) {
        const frame = document.createElement('iframe');
        frame.src = source.embedUrl;
        frame.title = `${source.providerName} · серия ${source.episodeNumber}`;
        frame.allow = 'fullscreen; picture-in-picture';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        frame.allowFullscreen = true;
        surface.append(frame);
      } else if (source.playbackUrl) {
        const video = document.createElement('video');
        video.src = source.playbackUrl;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        surface.append(video);
      }
      const credit = player.querySelector<HTMLElement>('[data-video-credit]')!;
      credit.replaceChildren();
      const link = document.createElement('a');
      link.textContent = source.sourceAttribution.label;
      link.href = source.sourceAttribution.url;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      credit.append(link);
    }
    episodes.addEventListener('change', populate);
    dubs.addEventListener('change', render);
    populate();
  });
}
