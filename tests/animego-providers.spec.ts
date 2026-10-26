import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  approvedAnimeGoEmbed,
  parseAnimeGoSources,
  AnimeGoResolver,
  animeGoProvider,
} from '../src/lib/providers/video/animego';
import { isAuthorizedSource } from '../src/lib/providers/video';
import index from '../src/data/animego-index.json' with { type: 'json' };
const read = (id: number) =>
  JSON.parse(readFileSync(`public/data/video/animego/${id}.json`, 'utf8'));
test('AnimeGO: every published cache has exact identity, approved iframes and unique episodes/voices', () => {
  expect(new Set(index.ids).size).toBe(index.ids.length);
  expect(index.ids.length).toBeGreaterThan(0);
  const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8')).anime;
  for (const id of index.ids) {
    const raw = read(id);
    const anime = catalog.find((a: { shikimoriId: number }) => a.shikimoriId === id);
    expect(anime).toBeDefined();
    expect(raw.year).toBe(anime.year);
    expect(raw.format.toLowerCase()).toBe(anime.kind);
    expect(raw.originalTitle).toBe(anime.originalTitle);
    const sources = parseAnimeGoSources(raw, id);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(isAuthorizedSource(source, animeGoProvider)).toBe(true);
      expect(source.playbackUrl).toBeUndefined();
      expect(source.translationId).toMatch(/^animego:/);
    }
  }
});
test('AnimeGO: reject wrong identity, foreign origins, credentials and duplicate translations', () => {
  const raw = read(41468);
  expect(() => parseAnimeGoSources(raw, 52299)).toThrow();
  expect(() =>
    parseAnimeGoSources({ ...raw, entries: [...raw.entries, raw.entries[0]] }, 41468),
  ).toThrow();
  for (const url of [
    'https://evil.example/cdn-iframe/1',
    'https://animego.me.evil.example/cdn-iframe/1',
    'http://animego.me/cdn-iframe/1',
    'https://user:pass@animego.me/cdn-iframe/1',
    'https://animego.me/cdn-iframe/1?token=secret',
    'https://animego.me/stream.m3u8',
  ])
    expect(approvedAnimeGoEmbed(url)).toBe(false);
});
test('AnimeGO: resolver fetches only reviewed IDs, deduplicates and retries failures', async () => {
  let calls = 0;
  const resolver = new AnimeGoResolver([41468], async () => {
    calls++;
    return read(41468);
  });
  expect(await resolver.getSources(54744)).toEqual([]);
  expect(calls).toBe(0);
  await Promise.all([resolver.getSources(41468), resolver.getSources(41468)]);
  expect(calls).toBe(1);
  let attempts = 0;
  const retry = new AnimeGoResolver([41468], async () => {
    if (++attempts === 1) throw Error('offline');
    return read(41468);
  });
  await expect(retry.getSources(41468)).rejects.toThrow('offline');
  expect((await retry.getSources(41468)).length).toBeGreaterThan(0);
  expect(await animeGoProvider.getSources('shikimori:41468')).toEqual([]); // Offline SSR never fetches.
});
