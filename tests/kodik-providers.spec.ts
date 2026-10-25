import { test, expect } from '@playwright/test';
import { kodikProvider } from '../src/lib/providers/video/kodik';
import { isAuthorizedSource } from '../src/lib/providers/video';
import mappings from '../src/data/kodik-mappings.json' with { type: 'json' };
import { kodikEventSource } from '../src/lib/providers/video/kodik-events';
import { readProgress, saveProgress, type PlayerProgress } from '../src/lib/player-progress';

test('Kodik: подтверждён только 39535, 11 эпизодов и неизменённые host/path/hash', async () => {
  const rows = await kodikProvider.getSources('shikimori:39535');
  expect([...new Set(rows.map((s) => s.episodeNumber))]).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  ]);
  expect(new Set(rows.map((s) => s.translationId)).size).toBe(15);
  for (const source of rows) {
    const url = new URL(source.embedUrl!);
    expect(url.origin).toBe('https://kodikplayer.com');
    expect(url.pathname).toBe(
      new URL(
        mappings['shikimori:39535'].translations.find((t) => t.id === source.translationId)!
          .embedUrl,
      ).pathname,
    );
    expect(url.searchParams.get('episode')).toBe(String(source.episodeNumber));
    expect(isAuthorizedSource(source, kodikProvider)).toBe(true);
    expect(source.availableRegions).toEqual([]);
  }
  for (const id of ['shikimori:52299', 'shikimori:45576', '39535', 'shikimori:999999'])
    expect(await kodikProvider.getSources(id)).toEqual([]);
});

test('MultiPlayer: первый iframe сохраняет прежний прогресс HLS отдельно по провайдеру', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const liberty: PlayerProgress = {
      animeId: 'shikimori:39535',
      providerId: 'aniliberty',
      releaseId: 'test',
      episodeNumber: 2,
      audio: 'ru|AniLiberty',
      time: 42,
      duration: 1200,
      updatedAt: new Date().toISOString(),
    };
    values.set('anirezik:playback:v1', JSON.stringify({ [liberty.animeId]: liberty }));
    saveProgress({
      ...liberty,
      providerId: 'kodik',
      releaseId: '31186',
      time: null,
      duration: null,
    });
    expect(readProgress(liberty.animeId, 'aniliberty')?.time).toBe(42);
    expect(readProgress(liberty.animeId, 'kodik')?.time).toBeNull();
    values.set('anirezik:playback-providers:v1', 'broken');
    expect(readProgress(liberty.animeId)?.providerId).toBe('kodik');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Kodik: реальные поля события, поддельный origin/frame/сезон/перевод не принимаются', async () => {
  const rows = await kodikProvider.getSources('shikimori:39535');
  const child = {} as Window;
  const frame = { contentWindow: child } as HTMLIFrameElement;
  const data = {
    key: 'kodik_player_current_episode',
    value: { episode: 2, season: 1, translation: { id: 610, title: 'Untrusted text is ignored' } },
  };
  const event = { origin: 'https://kodikplayer.com', source: child, data } as MessageEvent;
  expect(kodikEventSource(event, frame, rows)?.dubbingStudio).toBe('AniLibria.TV');
  expect(
    kodikEventSource({ ...event, origin: 'https://example.com' } as MessageEvent, frame, rows),
  ).toBeNull();
  expect(
    kodikEventSource({ ...event, source: {} as Window } as MessageEvent, frame, rows),
  ).toBeNull();
  for (const value of [
    { ...data.value, episode: 12 },
    { ...data.value, season: 2 },
    { ...data.value, translation: { id: 99999 } },
  ])
    expect(
      kodikEventSource({ ...event, data: { ...data, value } } as MessageEvent, frame, rows),
    ).toBeNull();
  expect(kodikEventSource({ ...event, data: '{bad' } as MessageEvent, frame, rows)).toBeNull();
});

test('Kodik: iframe policy не разрешает чужой origin, потоки и непроверенные права', async () => {
  const source = (await kodikProvider.getSources('shikimori:39535'))[0];
  expect(
    isAuthorizedSource({ ...source, embedUrl: 'https://example.com/frame' }, kodikProvider),
  ).toBe(false);
  expect(
    isAuthorizedSource(
      { ...source, playbackUrl: 'https://kodikplayer.com/video.mp4' },
      kodikProvider,
    ),
  ).toBe(false);
  expect(
    isAuthorizedSource(
      { ...source, qualities: [{ label: 'test', url: 'https://kodikplayer.com/v' }] },
      kodikProvider,
    ),
  ).toBe(false);
  expect(
    isAuthorizedSource(source, {
      ...kodikProvider,
      rights: { ...kodikProvider.rights, verified: false },
    }),
  ).toBe(false);
});
