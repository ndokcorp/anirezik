import { approvedProviders, isAuthorizedSource } from './providers/video';
import { setLibertyMetadata, type MatchMetadata } from './providers/video/aniliberty';
import { demoProvider } from './providers/video/demo';
import type { VideoSource } from './providers/video/types';
import type Hls from 'hls.js';
import { readProgress, saveProgress } from './player-progress';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
const timeLabel = (value: number) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
// Shared by pre-rendered and universal detail routes; never invoked by the catalog.
export async function loadPlayerSources(section: HTMLElement, animeId: string) {
  if (section.querySelector('[data-player]') || !approvedProviders.length) return;
  if (section.dataset.playerLoading) return;
  section.dataset.playerLoading = 'true';
  const placeholder = section.querySelector<HTMLElement>('.player-placeholder');
  const status = placeholder?.querySelector('p');
  if (status) status.textContent = 'Ищем релиз в AniLiberty…';
  let sources: VideoSource[] = [];
  try {
    const meta = JSON.parse(section.dataset.playerMeta || '{}') as MatchMetadata;
    if (typeof meta.title === 'string' && typeof meta.originalTitle === 'string')
      setLibertyMetadata(animeId, meta);
    for (const provider of approvedProviders)
      sources.push(
        ...(await provider.getSources(animeId)).filter(
          (source) => source.animeId === animeId && isAuthorizedSource(source, provider),
        ),
      );
    if (!sources.length) {
      if (status) status.textContent = 'Релиз пока не найден';
      return;
    }
  } catch (error) {
    if (status)
      status.textContent = error instanceof Error ? error.message : 'Не удалось загрузить релиз';
    if (placeholder && !placeholder.querySelector('button')) {
      const retry = make('button', 'Повторить поиск');
      retry.type = 'button';
      retry.className = 'button button-secondary';
      retry.onclick = () => {
        retry.remove();
        void loadPlayerSources(section, animeId);
      };
      placeholder.append(retry);
    }
    return;
  } finally {
    delete section.dataset.playerLoading;
  }
  if (!section.isConnected) return;
  const player = make('div');
  player.className = 'anime-player';
  player.dataset.player = '';
  player.dataset.title = section.querySelector('h2')?.textContent || '';
  const controls = make('div');
  controls.className = 'video-controls';
  for (const [label, field] of [
    ['Эпизод', 'videoEpisode'],
    ['Аудиодорожка', 'videoDub'],
  ]) {
    const wrapper = make('label', label);
    const select = make('select');
    select.dataset[field] = '';
    wrapper.append(select);
    controls.append(wrapper);
  }
  const surface = make('div');
  surface.dataset.videoSurface = '';
  const credit = make('p');
  credit.dataset.videoCredit = '';
  const json = make('script');
  json.type = 'application/json';
  json.dataset.videoSources = '';
  json.textContent = JSON.stringify(sources);
  player.append(controls, surface, credit, json);
  section.querySelector('.player-placeholder')?.replaceWith(player);
  initPlayers();
}
export function initPlayers() {
  document.querySelectorAll<HTMLElement>('[data-player]').forEach((player) => {
    if (player.dataset.ready) return;
    let rows: VideoSource[];
    try {
      rows = JSON.parse(player.querySelector('[data-video-sources]')?.textContent || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(rows)) return;
    const sources = rows.filter((source) => {
      const provider =
        source.animeId === 'demo:player'
          ? demoProvider
          : approvedProviders.find((p) => p.id === source.providerId);
      try {
        return provider && isAuthorizedSource(source, provider);
      } catch {
        return false;
      }
    });
    if (!sources.length) return;
    player.dataset.ready = 'true';
    const episodes = player.querySelector<HTMLSelectElement>('[data-video-episode]')!;
    const dubs = player.querySelector<HTMLSelectElement>('[data-video-dub]')!;
    const surface = player.querySelector<HTMLElement>('[data-video-surface]')!;
    const credit = player.querySelector<HTMLElement>('[data-video-credit]')!;
    const numbers = [...new Set(sources.map((s) => s.episodeNumber))].sort((a, b) => a - b);
    const saved = readProgress(sources[0].animeId);
    let source: VideoSource | undefined;
    let video: HTMLVideoElement | null = null,
      hls: Hls | null = null;
    let generation = 0,
      started = false,
      lastSave = 0,
      quality = '',
      pendingTime = 0;
    let restoreTime = saved?.time || 0;
    let rate = 1,
      volume = 1,
      muted = false;
    let saveCurrent: () => void = () => {};
    const transport = make('div');
    transport.className = 'episode-transport';
    const previous = make('button', '← Предыдущая'),
      next = make('button', 'Следующая →');
    previous.type = next.type = 'button';
    previous.className = next.className = 'button button-secondary';
    transport.append(previous, next);
    const layout = make('div');
    layout.className = 'player-layout';
    const options = make('aside');
    options.className = 'player-options';
    options.setAttribute('aria-label', 'Озвучка и серии');
    const heading = make('h3', 'ОЗВУЧКА И ЭПИЗОДЫ');
    const episodeGrid = make('div');
    episodeGrid.className = 'player-episodes';
    episodeGrid.setAttribute('role', 'group');
    episodeGrid.setAttribute('aria-label', 'Список серий');
    numbers.forEach((n) => {
      const button = make('button', String(n));
      button.type = 'button';
      button.dataset.episode = String(n);
      button.setAttribute('aria-label', `Выбрать серию ${n}`);
      button.onclick = () => {
        episodes.value = String(n);
        episodes.dispatchEvent(new Event('change'));
      };
      episodeGrid.append(button);
    });
    options.append(heading, player.querySelector('.video-controls')!, transport, episodeGrid);
    layout.append(surface, options);
    player.prepend(layout);
    episodes.replaceChildren(
      ...numbers.map(
        (n) =>
          new Option(
            `${sources[0].animeId === 'demo:player' ? 'Тестовый слот' : 'Серия'} ${n}`,
            String(n),
          ),
      ),
    );
    if (
      saved &&
      sources.some(
        (s) =>
          s.episodeNumber === saved.episodeNumber &&
          s.providerId === saved.providerId &&
          (s.releaseId || '') === saved.releaseId,
      )
    )
      episodes.value = String(saved.episodeNumber);
    function stop() {
      saveCurrent();
      saveCurrent = () => {};
      generation++;
      started = false;
      hls?.destroy();
      hls = null;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video = null;
      }
      surface.replaceChildren();
    }
    function render() {
      stop();
      source = sources[Number(dubs.value)];
      if (!source) return;
      const active = source;
      if (
        restoreTime &&
        (!saved ||
          saved.episodeNumber !== active.episodeNumber ||
          saved.providerId !== active.providerId ||
          saved.releaseId !== (active.releaseId || '') ||
          saved.audio !== active.audioLanguage + '|' + (active.dubbingStudio || ''))
      )
        restoreTime = 0;
      const currentGeneration = generation;
      previous.disabled = numbers.indexOf(active.episodeNumber) === 0;
      next.disabled = numbers.indexOf(active.episodeNumber) === numbers.length - 1;
      episodeGrid
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((button) =>
          button.setAttribute(
            'aria-pressed',
            String(Number(button.dataset.episode) === active.episodeNumber),
          ),
        );
      credit.replaceChildren();
      const link = make('a', active.sourceAttribution.label);
      link.href = active.sourceAttribution.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      credit.append(link);
      if (active.embedUrl) {
        const load = make('button', 'Открыть плеер источника');
        load.type = 'button';
        load.className = 'button button-primary';
        load.onclick = () => {
          const frame = make('iframe');
          frame.src = active.embedUrl!;
          frame.title = `${active.providerName} · серия ${active.episodeNumber}`;
          frame.allow = 'fullscreen; picture-in-picture';
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
          frame.allowFullscreen = true;
          surface.replaceChildren(frame);
          saveProgress({
            animeId: active.animeId,
            providerId: active.providerId,
            releaseId: active.releaseId || '',
            episodeNumber: active.episodeNumber,
            audio: active.audioLanguage + '|' + (active.dubbingStudio || ''),
            time: null,
            duration: null,
            updatedAt: new Date().toISOString(),
          });
        };
        surface.append(load);
        return;
      }
      const screen = make('div');
      screen.className = 'player-screen';
      const media = make('video');
      video = media;
      media.preload = 'none';
      media.playsInline = true;
      media.setAttribute('aria-label', 'Видео');
      media.playbackRate = rate;
      media.volume = volume;
      media.muted = muted;
      const poster = document.querySelector<HTMLImageElement>('.detail-poster');
      if (poster?.currentSrc) media.poster = poster.currentSrc;
      const overlay = make('button', '▶');
      overlay.className = 'player-big-play';
      overlay.type = 'button';
      overlay.setAttribute('aria-label', 'Воспроизвести видео');
      const intro = make('div');
      intro.className = 'player-intro';
      const title = make(
        'h3',
        player.dataset.title ||
          player.closest('section')?.querySelector('h2')?.textContent ||
          'AniRezik Player',
      );
      const summary = make(
        'p',
        `${active.animeId === 'demo:player' ? 'Тестовый слот' : 'Эпизод'} ${active.episodeNumber} · ${active.dubbingStudio || active.providerName}`,
      );
      intro.append(overlay, title, summary);
      const notice = make('p', 'Нажмите для воспроизведения');
      notice.className = 'player-status';
      notice.setAttribute('role', 'status');
      const controls = make('div');
      controls.className = 'player-controls';
      const play = make('button', '▶');
      play.type = 'button';
      play.setAttribute('aria-label', 'Воспроизвести');
      const seek = make('input');
      seek.type = 'range';
      seek.min = '0';
      seek.max = '0';
      seek.step = '0.1';
      seek.value = '0';
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Позиция видео');
      const clock = make('span', '0:00 / 0:00');
      clock.className = 'player-clock';
      const mute = make('button', '♫');
      mute.type = 'button';
      mute.setAttribute('aria-label', 'Выключить звук');
      const sound = make('input');
      sound.type = 'range';
      sound.min = '0';
      sound.max = '1';
      sound.step = '0.05';
      sound.value = String(volume);
      sound.setAttribute('aria-label', 'Громкость');
      sound.className = 'player-volume';
      const speed = make('select');
      speed.setAttribute('aria-label', 'Скорость');
      for (const n of [0.5, 0.75, 1, 1.25, 1.5, 2]) speed.add(new Option(`${n}×`, String(n)));
      speed.value = String(rate);
      const qualitySelect = make('select');
      qualitySelect.setAttribute('aria-label', 'Качество');
      const choices = active.qualities?.length
        ? active.qualities
        : [{ label: 'Исходное', url: active.playbackUrl! }];
      choices.forEach((q) => qualitySelect.add(new Option(q.label, q.url)));
      qualitySelect.value =
        quality && choices.some((q) => q.url === quality)
          ? quality
          : (
              choices.find(
                (q) => q.label === (matchMedia('(max-width: 760px)').matches ? '480p' : '720p'),
              ) || choices.at(-1)!
            ).url;
      qualitySelect.disabled = choices.length === 1;
      const full = make('button', '⛶');
      full.type = 'button';
      full.setAttribute('aria-label', 'Полный экран');
      const continueButton = make('button', `Продолжить с ${timeLabel(restoreTime)}`);
      continueButton.type = 'button';
      continueButton.className = 'button button-secondary player-continue';
      continueButton.hidden = restoreTime < 3;
      const retry = make('button', 'Повторить');
      retry.type = 'button';
      retry.className = 'button button-secondary';
      retry.hidden = true;
      screen.append(media, intro, notice);
      controls.append(play, seek, clock, mute, sound, speed, qualitySelect, full);
      surface.append(screen, controls, continueButton, retry);
      function persist() {
        if (!started || !Number.isFinite(media.duration) || media.duration <= 0) return;
        saveProgress({
          animeId: active.animeId,
          providerId: active.providerId,
          releaseId: active.releaseId || '',
          episodeNumber: active.episodeNumber,
          audio: active.audioLanguage + '|' + (active.dubbingStudio || ''),
          time: media.currentTime,
          duration: media.duration,
          updatedAt: new Date().toISOString(),
        });
        lastSave = Date.now();
      }
      saveCurrent = persist;
      const failed = (message: string) => {
        notice.textContent = message;
        retry.hidden = false;
        screen.classList.remove('is-loading');
        overlay.hidden = false;
        intro.hidden = false;
      };
      async function start() {
        if (generation !== currentGeneration) return;
        if (!started) {
          started = true;
          retry.hidden = true;
          screen.classList.add('is-loading');
          notice.textContent = 'Загрузка видео…';
          const stream = choices.some((q) => q.url === qualitySelect.value)
            ? qualitySelect.value
            : choices.at(-1)!.url;
          if (/\.m3u8(?:\?|$)/i.test(stream)) {
            try {
              const { default: HlsEngine } = await import('hls.js');
              if (generation !== currentGeneration) return;
              if (!HlsEngine.isSupported()) {
                if (!media.canPlayType('application/vnd.apple.mpegurl'))
                  throw new Error('HLS не поддерживается браузером');
                media.src = stream;
                await media.play();
                return;
              }
              const provider =
                active.animeId === 'demo:player'
                  ? demoProvider
                  : approvedProviders.find((p) => p.id === active.providerId)!;
              const allowed = (value: string) => {
                const parsed = new URL(value);
                return (
                  parsed.protocol === 'https:' &&
                  !parsed.username &&
                  !parsed.password &&
                  provider.rights.allowedPlaybackOrigins.includes(parsed.origin)
                );
              };
              hls = new HlsEngine({
                maxBufferLength: 30,
                xhrSetup(xhr, address) {
                  if (!allowed(address)) throw new Error('Источник потока не разрешён');
                  xhr.addEventListener('readystatechange', () => {
                    if (xhr.readyState >= 2 && xhr.responseURL && !allowed(xhr.responseURL))
                      xhr.abort();
                  });
                },
              });
              hls.on(HlsEngine.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                  hls?.destroy();
                  hls = null;
                  failed('Не удалось загрузить HLS. Повторите попытку.');
                }
              });
              hls.on(HlsEngine.Events.MANIFEST_PARSED, () => {
                if (hls && hls.levels.length > 1 && choices.length === 1) {
                  qualitySelect.replaceChildren(
                    new Option('Авто', 'auto'),
                    ...hls.levels.map((level, i) => new Option(`${level.height}p`, `level:${i}`)),
                  );
                  qualitySelect.value = 'auto';
                  qualitySelect.disabled = false;
                }
                void media.play().catch(() => {
                  failed('Нажмите ▶, чтобы начать');
                });
              });
              hls.loadSource(stream);
              hls.attachMedia(media);
            } catch (error) {
              failed(error instanceof Error ? error.message : 'HLS недоступен');
            }
            return;
          }
          media.src = stream;
        }
        try {
          await media.play();
        } catch {
          failed('Браузер не смог начать воспроизведение. Нажмите повторить.');
        }
      }
      const toggle = () => {
        if (media.paused) void start();
        else media.pause();
      };
      play.onclick = toggle;
      overlay.onclick = () => {
        if (!retry.hidden) retry.click();
        else toggle();
      };
      media.onclick = toggle;
      media.addEventListener('play', () => {
        intro.hidden = true;
        overlay.hidden = true;
        play.textContent = 'Ⅱ';
        play.setAttribute('aria-label', 'Пауза');
        continueButton.hidden = true;
      });
      media.addEventListener('pause', () => {
        intro.hidden = false;
        persist();
        play.textContent = '▶';
        play.setAttribute('aria-label', 'Воспроизвести');
        overlay.hidden = false;
      });
      media.addEventListener('waiting', () => {
        screen.classList.add('is-loading');
        notice.textContent = 'Загрузка…';
      });
      media.addEventListener('playing', () => {
        screen.classList.remove('is-loading');
        notice.textContent = '';
        retry.hidden = true;
      });
      media.addEventListener('error', () =>
        failed('Ошибка загрузки видео или неподдерживаемый формат.'),
      );
      media.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(media.duration)) {
          seek.max = String(media.duration);
          seek.disabled = false;
          if (pendingTime > 0) {
            media.currentTime = Math.min(pendingTime, Math.max(0, media.duration - 0.5));
            pendingTime = 0;
          }
        }
      });
      media.addEventListener('timeupdate', () => {
        seek.value = String(media.currentTime);
        clock.textContent = `${timeLabel(media.currentTime)} / ${timeLabel(media.duration)}`;
        if (Date.now() - lastSave > 5000) persist();
      });
      media.addEventListener('ended', () => {
        persist();
        notice.textContent = 'Видео завершено';
      });
      seek.oninput = () => {
        if (Number.isFinite(media.duration)) media.currentTime = Number(seek.value);
      };
      mute.onclick = () => {
        media.muted = !media.muted;
        muted = media.muted;
        mute.textContent = muted ? '×' : '♫';
        mute.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
      };
      sound.oninput = () => {
        media.volume = volume = Number(sound.value);
      };
      speed.onchange = () => {
        media.playbackRate = rate = Number(speed.value);
      };
      qualitySelect.onchange = () => {
        if (hls && (qualitySelect.value === 'auto' || qualitySelect.value.startsWith('level:'))) {
          hls.currentLevel =
            qualitySelect.value === 'auto' ? -1 : Number(qualitySelect.value.slice(6));
          return;
        }
        const position = media.currentTime;
        const playing = !media.paused;
        quality = qualitySelect.value;
        render();
        pendingTime = position;
        if (playing) surface.querySelector<HTMLButtonElement>('.player-big-play')?.click();
      };
      full.hidden = !document.fullscreenEnabled && !('webkitEnterFullscreen' in media);
      full.onclick = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else if (surface.requestFullscreen && document.fullscreenEnabled)
          void surface.requestFullscreen().catch(() => {});
        else
          (
            media as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
          ).webkitEnterFullscreen?.();
      };
      continueButton.onclick = () => {
        pendingTime = restoreTime;
        restoreTime = 0;
        void start();
      };
      retry.onclick = () => {
        hls?.destroy();
        hls = null;
        media.removeAttribute('src');
        media.load();
        started = false;
        void start();
      };
    }
    function populate() {
      const oldAudio = source
        ? source.audioLanguage + '|' + (source.dubbingStudio || '')
        : saved?.audio;
      dubs.replaceChildren();
      sources.forEach((entry, index) => {
        if (entry.episodeNumber === Number(episodes.value))
          dubs.add(
            new Option(
              `${entry.dubbingStudio || entry.providerName} · ${entry.audioLanguage}`,
              String(index),
            ),
          );
      });
      const matching = sources.findIndex(
        (s) =>
          s.episodeNumber === Number(episodes.value) &&
          s.audioLanguage + '|' + (s.dubbingStudio || '') === oldAudio,
      );
      if (matching >= 0) dubs.value = String(matching);
      render();
    }
    episodes.onchange = () => {
      restoreTime = 0;
      quality = '';
      populate();
    };
    dubs.onchange = () => {
      restoreTime = 0;
      quality = '';
      render();
    };
    previous.onclick = () => {
      episodes.selectedIndex--;
      episodes.dispatchEvent(new Event('change'));
    };
    next.onclick = () => {
      episodes.selectedIndex++;
      episodes.dispatchEvent(new Event('change'));
    };
    window.addEventListener('pagehide', () => {
      saveCurrent();
      video?.pause();
      hls?.stopLoad();
    });
    populate();
  });
}
