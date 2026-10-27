import { test, expect } from '@playwright/test';
import {
  refreshVideoSelection,
  videoFallbacks,
  sameVideoSelection,
} from '../src/lib/video-recovery';
import {
  animeVostProvider,
  parseAnimeVostPlaylist,
  AnimeVostResolver,
} from '../src/lib/providers/video/animevost';
import type { VideoProvider } from '../src/lib/providers/video/types';
const mapping = { releaseId: 1, episodeNumbers: [1, 2], kind: 'tv' };
const raw = (name = '1 серия', path = 'a') => ({
  name,
  std: `https://video.animetop.info/${path}.mp4`,
});
const original = parseAnimeVostPlaylist([raw()], 54744, mapping)[0];

test('recovery: refresh bypasses valid stale memory cache and deduplicates simultaneous refreshes', async () => {
  let clock = 1_000,
    calls = 0;
  const resolver = new AnimeVostResolver(
    async () => [raw('1 серия', String(++calls))],
    () => clock,
  );
  const first = await resolver.getSources(54744, mapping);
  expect((await resolver.getSources(54744, mapping))[0].playbackUrl).toBe(first[0].playbackUrl);
  const [a, b] = await Promise.all([
    resolver.refresh(54744, mapping),
    resolver.refresh(54744, mapping),
  ]);
  expect(a).toEqual(b);
  expect(calls).toBe(2);
  expect(a[0].playbackUrl).not.toBe(first[0].playbackUrl);
  await expect(resolver.refresh(54744, mapping)).rejects.toThrow('30 секунд');
  expect(calls).toBe(2);
  clock += 30_000;
  await resolver.refresh(54744, mapping);
  expect(calls).toBe(3);
  clock += 5 * 60_000 + 1;
  await resolver.getSources(54744, mapping);
  expect(calls).toBe(4);
});

test('recovery: reject missing episode, wrong identity, foreign playback origins and ambiguous replacements', async () => {
  const other = { ...original, episodeNumber: 2 };
  for (const values of [
    [other],
    [{ ...original, animeId: 'shikimori:33' }],
    [{ ...original, playbackUrl: 'https://evil.example/a.mp4' }],
    [original, original],
  ]) {
    const provider = { ...animeVostProvider, refreshSources: async () => values };
    await expect(refreshVideoSelection(original, provider)).rejects.toThrow();
  }
  const refreshed = { ...original, playbackUrl: 'https://video.animetop.info/new.mp4' };
  const value = await refreshVideoSelection(original, {
    ...animeVostProvider,
    refreshSources: async () => [refreshed],
  });
  expect(value?.selected.playbackUrl).toBe(refreshed.playbackUrl);
  expect(sameVideoSelection(original, { ...original, translationId: 'other' })).toBe(false);
});

test('fallback: only approved same-anime same-episode sources; no timeline transfer or wrong saved season', () => {
  const alternate: VideoProvider = { ...animeVostProvider, id: 'alternate', name: 'Alternate' };
  const row = { ...original, providerId: alternate.id, providerName: alternate.name };
  const choices = videoFallbacks(
    original,
    [original, { ...row, episodeNumber: 2 }, { ...row, animeId: 'shikimori:33' }, row, row],
    [animeVostProvider, alternate],
  );
  expect(choices).toEqual([row]);
  expect(
    videoFallbacks(
      original,
      [row],
      [{ ...alternate, rights: { ...alternate.rights, verified: false } }],
    ),
  ).toEqual([]);
});

test('standalone OVA/ONA: explicit singleton labels need exact format; TV extras remain excluded', () => {
  for (const [kind, label] of [
    ['ova', 'ОВА'],
    ['ona', 'ONA'],
  ]) {
    const sources = parseAnimeVostPlaylist([raw(label)], 1761, {
      ...mapping,
      kind,
      episodeNumbers: [1],
    });
    expect(sources).toHaveLength(1);
    expect(
      parseAnimeVostPlaylist([raw(label)], 1761, { ...mapping, kind: 'tv', episodeNumbers: [1] }),
    ).toEqual([]);
    expect(
      parseAnimeVostPlaylist([raw(label)], 1761, { ...mapping, kind, episodeNumbers: [1, 2] }),
    ).toEqual([]);
  }
});
