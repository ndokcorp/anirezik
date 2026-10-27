import { test, expect } from '@playwright/test';
import {
  animeVostMedia,
  parseAnimeVostPlaylist,
  AnimeVostResolver,
  animeVostProvider,
} from '../src/lib/providers/video/animevost';
import { isAuthorizedSource } from '../src/lib/providers/video';

const row = {
  name: '1 серия',
  std: 'http://video.animetop.info/test-480.mp4',
  hd: 'https://video.animetop.info/test-720.mp4',
};
const mapping = { releaseId: 3195, episodeNumbers: [1, 2], kind: 'tv' };

test('AnimeVost: TLS allowlist, no credentials, alternate ports, queries or foreign hosts', () => {
  expect(animeVostMedia(row.std)).toBe('https://video.animetop.info/test-480.mp4');
  for (const value of [
    'https://evil.example/a.mp4',
    'https://video.animetop.info.evil.example/a.mp4',
    'https://user@video.animetop.info/a.mp4',
    'https://video.animetop.info:444/a.mp4',
    'https://video.animetop.info/a.mp4?token=x',
    'https://video.animetop.info/a.mp4#x',
    'javascript:alert(1)',
  ]) {
    expect(animeVostMedia(value)).toBeNull();
  }
});

test('AnimeVost: exact mapped episode labels, own studio, no invented extras or worldwide claim', () => {
  const sources = parseAnimeVostPlaylist(
    [row, { ...row, name: 'OVA' }, { ...row, name: '3 серия' }],
    54744,
    mapping,
  );
  expect(sources).toHaveLength(1);
  expect(sources[0].animeId).toBe('shikimori:54744');
  expect(sources[0].episodeNumber).toBe(1);
  expect(sources[0].dubbingStudio).toBe('AnimeVost');
  expect(sources[0].qualities?.map((q) => q.label)).toEqual(['480p', '720p']);
  expect(sources[0].availableRegions).toEqual([]);
  expect(sources[0].regionChecked).toBeUndefined();
  expect(isAuthorizedSource(sources[0], animeVostProvider)).toBe(true);
  expect(
    isAuthorizedSource({ ...sources[0], blockedRegions: ['RU'] }, animeVostProvider, 'RU'),
  ).toBe(false);
  expect(
    isAuthorizedSource(sources[0], {
      ...animeVostProvider,
      rights: { ...animeVostProvider.rights, playbackAllowed: false },
    }),
  ).toBe(false);
  expect(() => parseAnimeVostPlaylist([row, row], 54744, mapping)).toThrow();
  expect(
    parseAnimeVostPlaylist([{ ...row, std: 'https://evil.example/a.mp4', hd: '' }], 54744, mapping),
  ).toEqual([]);
});

test('AnimeVost: movie is one mapped movie entry, not every named extra', () => {
  expect(
    parseAnimeVostPlaylist([{ ...row, name: 'Фильм' }], 32281, {
      releaseId: 1742,
      episodeNumbers: [1],
    }),
  ).toHaveLength(1);
  expect(parseAnimeVostPlaylist([{ ...row, name: 'Фильм' }], 54744, mapping)).toEqual([]);
});

test('AnimeVost: transient request cache deduplicates; failures are retryable', async () => {
  let calls = 0;
  const resolver = new AnimeVostResolver(async () => {
    calls++;
    if (calls === 1) throw Error('HTTP 503');
    return [row];
  });
  await expect(resolver.getSources(54744, mapping)).rejects.toThrow('503');
  const [a, b] = await Promise.all([
    resolver.getSources(54744, mapping),
    resolver.getSources(54744, mapping),
  ]);
  expect(a).toEqual(b);
  expect(calls).toBe(2);
});
