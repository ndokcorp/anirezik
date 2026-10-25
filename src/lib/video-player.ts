import { approvedProviders, isAuthorizedSource } from './providers/video';
import { setLibertyMetadata, type MatchMetadata } from './providers/video/aniliberty';
import { demoProvider } from './providers/video/demo';
import type { VideoSource } from './providers/video/types';
import type Hls from 'hls.js';
import { lazyPlayerFrame } from './lazy-player-frame';
import { initFilterControls } from './filter-controls';
import { readProgress, saveProgress } from './player-progress';
import { formatPlayerTime as timeLabel, playerIcon, bindPlayerGestures } from './player-controls';
import {
  readAutoNext,
  saveAutoNext,
  readPlayerProvider,
  savePlayerProvider,
  readVoiceFavourites,
  saveVoiceFavourites,
} from './player-preferences';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
// Shared by pre-rendered and universal detail routes; never invoked by the catalog.
export async function loadPlayerSources(section: HTMLElement, animeId: string) {
  if (section.querySelector('[data-player]') || !approvedProviders.length) return;
  if (section.dataset.playerLoading) return;
  section.dataset.playerLoading = 'true';
  const placeholder = section.querySelector<HTMLElement>('.player-placeholder');
  const status = placeholder?.querySelector('p');
  if (status) status.textContent = 'Ищем доступные источники…';
  let sources: VideoSource[] = [];
  try {
    const meta = JSON.parse(section.dataset.playerMeta || '{}') as MatchMetadata;
    if (typeof meta.title === 'string' && typeof meta.originalTitle === 'string')
      setLibertyMetadata(animeId, meta);
    const failures: unknown[] = [];
    for (const provider of approvedProviders) {
      try {
        sources.push(
          ...(await provider.getSources(animeId)).filter(
            (source) => source.animeId === animeId && isAuthorizedSource(source, provider),
          ),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (!sources.length && failures.length) throw failures[0];
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
    ['Озвучка', 'videoDub'],
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
    player.dataset.providerLayout = 'top';
    const episodes = player.querySelector<HTMLSelectElement>('[data-video-episode]')!;
    const dubs = player.querySelector<HTMLSelectElement>('[data-video-dub]')!;
    const surface = player.querySelector<HTMLElement>('[data-video-surface]')!;
    const credit = player.querySelector<HTMLElement>('[data-video-credit]')!;
    const providers = make('select');
    providers.dataset.videoProvider = '';
    const providerLabel = make('div');
    const providerCaption = make('span', 'Плеер');
    providerCaption.className = 'player-provider-caption';
    providerLabel.append(providerCaption);
    providerLabel.append(providers);
    const providerIds = [...new Set(sources.map((s) => s.providerId))];
    providers.replaceChildren(
      ...providerIds.map(
        (id) =>
          new Option(
            `${sources.find((s) => s.providerId === id)!.providerName} (${new Set(sources.filter((s) => s.providerId === id).map((s) => s.episodeNumber)).size} эп.)`,
            id,
          ),
      ),
    );
    const preferredProvider = readPlayerProvider(sources[0].animeId);
    if (preferredProvider && providerIds.includes(preferredProvider))
      providers.value = preferredProvider;
    const controls = player.querySelector('.video-controls')!;
    controls.append(providerLabel);
    providers.id = `provider-${sources[0].animeId.replace(/[^a-z0-9-]/gi, '-')}`;
    providerLabel.className = 'player-provider-control';
    if (providerIds.length > 1) initFilterControls(providerLabel);
    else {
      providers.hidden = true;
      const badge = make('span', providers.selectedOptions[0].textContent || '');
      badge.className = 'player-provider-badge';
      providerLabel.append(badge);
    }
    // Provider and voice controls above the numbered episode row, as on the reference.
    dubs.closest('label')!.hidden = true;
    episodes.closest('label')!.hidden = true;
    let numbers: number[] = [];
    let disposeEmbed: () => void = () => {};
    let disposeNativeUI: () => void = () => {};
    let autoNext = readAutoNext(),
      autoStartRequested = false,
      lastAudibleVolume = 1;
    let saved = readProgress(sources[0].animeId, providers.value);
    let source: VideoSource | undefined;
    let confirmedSource: VideoSource | undefined;
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
    const stage = make('div');
    stage.className = 'player-stage';
    const options = make('aside');
    options.className = 'player-options';
    options.setAttribute('aria-label', 'Озвучка и серии');
    const heading = make('h3', 'ОЗВУЧКА И ЭПИЗОДЫ');
    const episodeGrid = make('div');
    episodeGrid.className = 'player-episodes';
    episodeGrid.setAttribute('role', 'group');
    episodeGrid.setAttribute('aria-label', 'Список серий');
    const selectionNote = make('p');
    selectionNote.className = 'player-selection-status';
    selectionNote.setAttribute('role', 'status');
    const frameNotice = make('div');
    frameNotice.className = 'player-frame-notice';
    frameNotice.hidden = true;
    function selectedSource() {
      return source?.embedUrl &&
        approvedProviders.find((p) => p.id === source?.providerId)?.readStateEvent
        ? confirmedSource?.providerId === source.providerId
          ? confirmedSource
          : undefined
        : source;
    }
    function updateSelection() {
      const selected = selectedSource();
      episodeGrid.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(!!selected && Number(button.dataset.episode) === selected.episodeNumber),
        );
        button.toggleAttribute(
          'data-pending',
          !!source?.embedUrl &&
            Number(button.dataset.episode) === source.episodeNumber &&
            selected?.episodeNumber !== source.episodeNumber,
        );
      });
      const pending = !!source?.embedUrl && (!selected || selected !== source);
      selectionNote.hidden =
        !source?.embedUrl ||
        !approvedProviders.find((p) => p.id === source?.providerId)?.readStateEvent;
      selectionNote.textContent = pending
        ? selected
          ? selected.episodeNumber === source!.episodeNumber
            ? `Ожидаем подтверждения перевода ${source!.providerName}.`
            : `Подтверждено: ${selected.episodeNumber} · Запрошено: ${source!.episodeNumber}`
          : `Серия ${source!.episodeNumber} — ждём сигнала ${source!.providerName}.`
        : selected
          ? `Последнее подтверждение: серия ${selected.episodeNumber}`
          : '';
    }
    function populateEpisodes() {
      const previousEpisode = episodes.value;
      numbers = [
        ...new Set(
          sources.filter((s) => s.providerId === providers.value).map((s) => s.episodeNumber),
        ),
      ].sort((a, b) => a - b);
      episodeGrid.replaceChildren();
      episodes.replaceChildren(...numbers.map((n) => new Option(`Серия ${n}`, String(n))));
      if (numbers.includes(Number(previousEpisode))) episodes.value = previousEpisode;
      numbers.forEach((n) => {
        const button = make('button', String(n));
        button.type = 'button';
        button.dataset.episode = String(n);
        button.setAttribute('aria-label', `Выбрать серию ${n}`);
        button.onclick = () => {
          if (episodes.value === String(n)) return;
          episodes.value = String(n);
          episodes.dispatchEvent(new Event('change'));
        };
        episodeGrid.append(button);
      });
    }
    populateEpisodes();
    options.append(
      heading,
      player.querySelector('.video-controls')!,
      transport,
      episodeGrid,
      selectionNote,
      frameNotice,
    );
    heading.hidden = true;
    transport.hidden = true;
    stage.append(options, surface);
    const voices = make('aside');
    voices.className = 'player-voices';
    voices.setAttribute('aria-label', 'Озвучки');
    const voiceHeading = make('h3', 'ОЗВУЧКИ');
    const voiceSearch = make('input');
    voiceSearch.type = 'search';
    voiceSearch.placeholder = 'Поиск озвучки';
    voiceSearch.setAttribute('aria-label', 'Поиск озвучки');
    const voiceList = make('div');
    voiceList.className = 'player-voice-list';
    const favourites = readVoiceFavourites();
    voices.append(voiceHeading, voiceSearch, voiceList);
    layout.append(stage, voices);
    player.prepend(layout);
    const stageSize = new ResizeObserver(() =>
      player.style.setProperty(
        '--voice-panel-height',
        `${Math.ceil(stage.getBoundingClientRect().height)}px`,
      ),
    );
    stageSize.observe(stage);
    const visibility = new IntersectionObserver((entries) => {
      player.dataset.mediaVisible = String(entries.some((e) => e.isIntersecting));
    });
    visibility.observe(layout);
    if (
      saved &&
      sources.some(
        (s) =>
          s.episodeNumber === saved?.episodeNumber &&
          s.providerId === providers.value &&
          s.providerId === saved?.providerId &&
          (s.releaseId || '') === saved?.releaseId,
      )
    )
      episodes.value = String(saved.episodeNumber);
    function stop() {
      saveCurrent();
      saveCurrent = () => {};
      generation++;
      disposeNativeUI();
      disposeNativeUI = () => {};
      disposeEmbed();
      disposeEmbed = () => {};
      frameNotice.hidden = true;
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
      delete player.dataset.iframeActive;
    }
    function render() {
      stop();
      source = sources[Number(dubs.value)];
      if (!source) return;
      updateSelection();
      renderVoices();
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
      credit.replaceChildren();
      const link = make('a', active.sourceAttribution.label);
      link.href = active.sourceAttribution.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const currentProvider =
        active.providerId === demoProvider.id
          ? demoProvider
          : approvedProviders.find((p) => p.id === active.providerId);
      credit.hidden = !currentProvider?.attributionRequired;
      if (!credit.hidden) credit.append(link);
      if (active.embedUrl) {
        autoStartRequested = false;
        // A loaded document is not a playback or episode confirmation.
        disposeEmbed = lazyPlayerFrame(surface, active, currentProvider?.iframePolicy, {
          loaded: () => {
            if (generation !== currentGeneration) return;
            player.dataset.iframeActive = 'true';
            frameNotice.hidden = true;
            savePlayerProvider(active.animeId, active.providerId);
          },
          failed: (timeout) => {
            if (generation !== currentGeneration) return;
            frameNotice.replaceChildren(
              make('p', timeout ? 'Плеер отвечает дольше обычного.' : 'Не удалось открыть плеер.'),
            );
            const retry = make('button', 'Повторить');
            retry.type = 'button';
            retry.className = 'button button-secondary';
            retry.onclick = render;
            frameNotice.append(retry);
            const alternative = providerIds.find((id) => id !== active.providerId);
            if (alternative) {
              const backup = make(
                'button',
                `Выбрать ${sources.find((s) => s.providerId === alternative)!.providerName}`,
              );
              backup.type = 'button';
              backup.className = 'button button-secondary';
              backup.onclick = () => {
                providers.value = alternative;
                providers.dispatchEvent(new Event('change', { bubbles: true }));
              };
              frameNotice.append(backup);
            }
            frameNotice.hidden = false;
          },
        });
        return;
      }
      const autoStart = autoStartRequested;
      autoStartRequested = false;
      const ui = new AbortController();
      disposeNativeUI = () => ui.abort();
      const screen = make('div');
      screen.className = 'player-screen anirize-screen';
      screen.tabIndex = 0;
      screen.setAttribute('role', 'group');
      screen.setAttribute('aria-label', 'Плеер AniRize');
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
      const overlay = make('button');
      overlay.append(playerIcon('play'));
      overlay.className = 'player-big-play';
      overlay.type = 'button';
      overlay.setAttribute('aria-label', 'Воспроизвести видео');
      const intro = make('div');
      intro.className = 'player-intro';
      intro.append(overlay);
      const brand = make('span', 'AniRize');
      brand.className = 'player-brand';
      const notice = make('p', 'Нажмите для воспроизведения');
      notice.className = 'player-status';
      notice.setAttribute('role', 'status');
      const controls = make('div');
      controls.className = 'player-controls';
      const play = make('button');
      play.append(playerIcon('play'));
      play.type = 'button';
      play.setAttribute('aria-label', 'Воспроизвести');
      const seek = make('input');
      seek.className = 'player-timeline';
      seek.type = 'range';
      seek.min = '0';
      seek.max = '0';
      seek.step = '0.1';
      seek.value = '0';
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Позиция видео');
      const clock = make('span', '0:00 / 0:00');
      clock.className = 'player-clock';
      const mute = make('button');
      mute.append(playerIcon('volume'));
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
      const full = make('button');
      full.append(playerIcon('fullscreen'));
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
      const settingsButton = make('button');
      settingsButton.type = 'button';
      settingsButton.append(playerIcon('settings'));
      settingsButton.setAttribute('aria-label', 'Настройки');
      settingsButton.setAttribute('aria-expanded', 'false');
      settingsButton.title = 'Настройки';
      const settings = make('div');
      settings.className = 'player-settings';
      settings.hidden = true;
      settings.id = `settings-${generation}-${active.animeId.replace(/\W/g, '-')}`;
      speed.id = `${settings.id}-speed`;
      qualitySelect.id = `${settings.id}-quality`;
      settings.setAttribute('role', 'group');
      settings.setAttribute('aria-label', 'Настройки AniRize');
      settingsButton.setAttribute('aria-controls', settings.id);
      for (const [text, select] of [
        ['Качество', qualitySelect],
        ['Скорость', speed],
      ] as const) {
        const row = make('label');
        row.append(make('span', text), select);
        settings.append(row);
      }
      const autoRow = make('label');
      autoRow.className = 'player-auto-next';
      const auto = make('input');
      auto.type = 'checkbox';
      auto.checked = autoNext;
      auto.setAttribute('aria-label', 'Автопереключение серий');
      auto.onchange = () => {
        autoNext = auto.checked;
        saveAutoNext(autoNext);
      };
      autoRow.append(make('span', 'Автопереключение серий'), auto);
      settings.append(autoRow);
      const closeSettings = () => {
        settings.hidden = true;
        settingsButton.setAttribute('aria-expanded', 'false');
      };
      settingsButton.onclick = () => {
        settings.hidden = !settings.hidden;
        settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
        settingsButton.focus({ preventScroll: true });
      };
      settings.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSettings();
          settingsButton.focus();
        }
      });
      document.addEventListener(
        'click',
        (event) => {
          if (
            !settings.contains(event.target as Node) &&
            !settingsButton.contains(event.target as Node)
          )
            closeSettings();
        },
        { signal: ui.signal },
      );
      initFilterControls(settings, { signal: ui.signal });
      const episodeNav = make('div');
      episodeNav.className = 'player-invideo-nav';
      for (const [control, icon, label] of [
        [previous, 'previous', 'Предыдущая серия'],
        [next, 'next', 'Следующая серия'],
      ] as const) {
        const button = make('button');
        button.type = 'button';
        button.append(playerIcon(icon));
        button.disabled = control.disabled;
        button.setAttribute('aria-label', label);
        button.title = label;
        button.onclick = () => {
          if (control.disabled) return;
          autoStartRequested = !media.paused;
          control.click();
        };
        episodeNav.append(button);
      }
      const bar = make('div');
      bar.className = 'player-control-bar';
      bar.append(play, clock, mute, sound, settingsButton, full);
      controls.append(seek, bar);
      screen.append(media, intro, brand, episodeNav, notice, controls, settings);
      surface.append(screen, continueButton, retry);
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
                  initFilterControls(settings, { signal: ui.signal });
                }
                void media.play().catch(() => {
                  failed('Нажмите «Воспроизвести», чтобы начать');
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
      bindPlayerGestures(screen, media, { toggle, mute: () => mute.click(), signal: ui.signal });
      media.addEventListener('play', () => {
        intro.hidden = true;
        overlay.hidden = true;
        play.replaceChildren(playerIcon('pause'));
        screen.classList.add('is-playing');
        play.setAttribute('aria-label', 'Пауза');
        continueButton.hidden = true;
      });
      media.addEventListener('pause', () => {
        intro.hidden = false;
        persist();
        play.replaceChildren(playerIcon('play'));
        screen.classList.remove('is-playing');
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
      const updateClock = () => {
        seek.value = String(media.currentTime);
        clock.textContent = `${timeLabel(media.currentTime)} / ${timeLabel(media.duration)}`;
        seek.style.setProperty(
          '--progress',
          `${Number.isFinite(media.duration) && media.duration > 0 ? Math.max(0, Math.min(100, (media.currentTime / media.duration) * 100)) : 0}%`,
        );
      };
      media.addEventListener('durationchange', updateClock);
      media.addEventListener('loadedmetadata', updateClock);
      media.addEventListener('timeupdate', () => {
        updateClock();
        if (Date.now() - lastSave > 5000) persist();
      });
      media.addEventListener('ended', () => {
        if (generation !== currentGeneration) return;
        persist();
        notice.textContent = 'Видео завершено';
        if (
          autoNext &&
          sources.some(
            (entry) =>
              entry.providerId === active.providerId &&
              entry.episodeNumber === active.episodeNumber + 1 &&
              voiceKey(entry) === voiceKey(active),
          )
        ) {
          autoStartRequested = true;
          episodes.value = String(active.episodeNumber + 1);
          episodes.dispatchEvent(new Event('change'));
        }
      });
      seek.oninput = () => {
        if (Number.isFinite(media.duration)) media.currentTime = Number(seek.value);
      };
      const syncVolume = () => {
        volume = media.volume;
        muted = media.muted;
        if (volume > 0) lastAudibleVolume = volume;
        const silent = muted || volume === 0;
        mute.replaceChildren(playerIcon(silent ? 'muted' : 'volume'));
        mute.setAttribute('aria-label', silent ? 'Включить звук' : 'Выключить звук');
        mute.title = `${silent ? 'Включить звук' : 'Выключить звук'} (m)`;
        sound.value = String(silent ? 0 : volume);
      };
      media.addEventListener('volumechange', syncVolume);
      mute.onclick = () => {
        if (media.muted || media.volume === 0) {
          media.muted = false;
          if (media.volume === 0) media.volume = lastAudibleVolume;
        } else media.muted = true;
        syncVolume();
      };
      sound.oninput = () => {
        media.muted = false;
        media.volume = Number(sound.value);
        syncVolume();
      };
      syncVolume();
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
      if (autoStart)
        queueMicrotask(() => {
          if (generation === currentGeneration) void start();
        });
    }
    function voiceKey(entry: VideoSource) {
      return `${entry.providerId}:${entry.translationId || `${entry.dubbingStudio || entry.providerName}|${entry.audioLanguage}|${entry.subtitles.join(',')}`}`;
    }
    function renderVoices() {
      const groups = new Map<string, { entry: VideoSource; indices: number[] }>();
      sources.forEach((entry, index) => {
        if (entry.providerId !== providers.value) return;
        const key = voiceKey(entry);
        const group = groups.get(key) || { entry, indices: [] };
        group.indices.push(index);
        groups.set(key, group);
      });
      voiceHeading.textContent = `ОЗВУЧКИ И СУБТИТРЫ · ${groups.size}`;
      voiceList.replaceChildren();
      const query = voiceSearch.value.trim().toLocaleLowerCase();
      [...groups.entries()]
        .sort(([a], [b]) => Number(favourites.has(b)) - Number(favourites.has(a)))
        .forEach(([key, group]) => {
          const label = group.entry.dubbingStudio || group.entry.providerName;
          if (!label.toLocaleLowerCase().includes(query)) return;
          const row = make('div');
          row.className = 'player-voice-row';
          const star = make('button', favourites.has(key) ? '★' : '☆');
          star.type = 'button';
          star.className = 'voice-favourite';
          star.setAttribute('aria-label', `Любимая озвучка: ${label}`);
          star.setAttribute('aria-pressed', String(favourites.has(key)));
          star.onclick = () => {
            if (favourites.has(key)) favourites.delete(key);
            else favourites.add(key);
            saveVoiceFavourites(favourites);
            renderVoices();
          };
          const choice = make('button');
          choice.type = 'button';
          choice.className = 'voice-choice';
          choice.setAttribute('aria-label', `Выбрать перевод: ${label}`);
          choice.toggleAttribute(
            'data-pending',
            !!source?.embedUrl &&
              voiceKey(source) === key &&
              (!selectedSource() || voiceKey(selectedSource()!) !== key),
          );
          choice.setAttribute(
            'aria-pressed',
            String(!!selectedSource() && voiceKey(selectedSource()!) === key),
          );
          const text = make('span', label);
          const badge = make(
            'small',
            `${new Set(group.indices.map((i) => sources[i].episodeNumber)).size} эп.`,
          );
          const details = make('span');
          details.className = 'voice-name';
          details.append(text, make('em', group.entry.subtitles.length ? 'Субтитры' : 'Озвучка'));
          choice.append(details, badge);
          choice.onclick = () => {
            if (source && voiceKey(source) === key) return;
            const index =
              group.indices.find((i) => sources[i].episodeNumber === Number(episodes.value)) ??
              group.indices[0];
            episodes.value = String(sources[index].episodeNumber);
            restoreTime = 0;
            quality = '';
            savePlayerProvider(sources[0].animeId, providers.value);
            populate(index);
          };
          row.append(star, choice);
          voiceList.append(row);
        });
      if (!voiceList.childElementCount) voiceList.append(make('p', 'Ничего не найдено'));
    }
    voiceSearch.oninput = renderVoices;
    const onProviderMessage = (event: MessageEvent) => {
      if (!player.isConnected || !source?.embedUrl) return;
      const frame = surface.querySelector('iframe');
      if (!frame) return;
      if (event.source !== frame.contentWindow || event.origin !== new URL(source.embedUrl).origin)
        return;
      const provider = approvedProviders.find((p) => p.id === source!.providerId);
      const selected = provider?.readStateEvent?.(
        event,
        frame,
        sources.filter((s) => s.animeId === source!.animeId && s.providerId === source!.providerId),
      );
      if (!selected || !sources.includes(selected) || selected.providerId !== provider?.id) return;
      savePlayerProvider(selected.animeId, selected.providerId);
      confirmedSource = selected;
      source = selected;
      episodes.value = String(selected.episodeNumber);
      dubs.replaceChildren(
        ...sources.flatMap((entry, index) =>
          entry.providerId === selected.providerId && entry.episodeNumber === selected.episodeNumber
            ? [new Option(entry.dubbingStudio || entry.providerName, String(index))]
            : [],
        ),
      );
      dubs.value = String(sources.indexOf(selected));
      previous.disabled = numbers.indexOf(selected.episodeNumber) === 0;
      next.disabled = numbers.indexOf(selected.episodeNumber) === numbers.length - 1;
      episodeGrid
        .querySelectorAll('button')
        .forEach((button) =>
          button.setAttribute(
            'aria-pressed',
            String(Number(button.dataset.episode) === selected.episodeNumber),
          ),
        );
      updateSelection();
      frame.title = `${selected.providerName} · серия ${selected.episodeNumber}`;
      renderVoices();
      saveProgress({
        animeId: selected.animeId,
        providerId: selected.providerId,
        releaseId: selected.releaseId || '',
        episodeNumber: selected.episodeNumber,
        audio: selected.audioLanguage + '|' + (selected.dubbingStudio || ''),
        time: null,
        duration: null,
        updatedAt: new Date().toISOString(),
        selectionConfirmed: true,
      });
    };
    window.addEventListener('message', onProviderMessage);
    function populate(preferredIndex?: number) {
      const oldAudio = source
        ? source.audioLanguage + '|' + (source.dubbingStudio || '')
        : saved?.audio;
      dubs.replaceChildren();
      sources.forEach((entry, index) => {
        if (entry.providerId === providers.value && entry.episodeNumber === Number(episodes.value))
          dubs.add(
            new Option(
              `${entry.dubbingStudio || entry.providerName} · ${entry.audioLanguage}`,
              String(index),
            ),
          );
      });
      const matching =
        preferredIndex ??
        sources.findIndex(
          (s) =>
            s.episodeNumber === Number(episodes.value) &&
            s.providerId === providers.value &&
            s.audioLanguage + '|' + (s.dubbingStudio || '') === oldAudio,
        );
      if (matching >= 0) dubs.value = String(matching);
      dubs.disabled = false;
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
    let activeProvider = providers.value;
    providers.onchange = () => {
      if (providers.value === activeProvider) return;
      activeProvider = providers.value;
      stop();
      savePlayerProvider(sources[0].animeId, providers.value);
      saved = readProgress(sources[0].animeId, providers.value);
      restoreTime = saved?.time || 0;
      confirmedSource = undefined;
      source = undefined;
      populateEpisodes();
      if (saved && numbers.includes(saved.episodeNumber))
        episodes.value = String(saved.episodeNumber);
      populate();
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
      window.removeEventListener('message', onProviderMessage);
      stop();
      stageSize.disconnect();
      visibility.disconnect();
      delete player.dataset.mediaVisible;
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted || !player.isConnected) return;
      window.addEventListener('message', onProviderMessage);
      stageSize.observe(stage);
      visibility.observe(layout);
      saved = readProgress(sources[0].animeId, providers.value);
      restoreTime = saved?.time || 0;
      source = undefined;
      populateEpisodes();
      if (saved && numbers.includes(saved.episodeNumber))
        episodes.value = String(saved.episodeNumber);
      populate();
    });
    populate();
  });
}
