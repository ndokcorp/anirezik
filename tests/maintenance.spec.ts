import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncMaintenance } from '../src/lib/providers/shikimori/maintenance';
import { assertCatalogUpdate } from '../src/lib/providers/shikimori/snapshot';
import { mapAnime } from '../src/lib/providers/shikimori/mapper';
import fixture from './fixtures/shikimori.json' with { type: 'json' };
import type { CatalogSnapshot } from '../src/types/anime';
const options = { base: 'https://shikimori.io', fetchedAt: '2026-10-24T00:00:00Z' };
const raw = fixture.data.animes[0];
const old = mapAnime(raw, options);
const previous: CatalogSnapshot = {
  schemaVersion: 2,
  source: 'shikimori',
  endpoint: options.base,
  fetchedAt: options.fetchedAt,
  policy: { posters: 'placeholder', descriptions: 'editorial-only', popularity: 'editorial' },
  anime: [{ ...old, sourceStatus: 'released', releasedOn: null }],
};
const changed = {
  ...raw,
  score: 9.7,
  poster: {
    mainUrl: 'https://shikimori.io/uploads/new-hash.webp',
    originalUrl: 'https://shikimori.io/uploads/new-original.jpg',
  },
};

test('maintenance: все 30704 ID сохранены, новые записи и URL обновляются без лимита 5000', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-maintenance-'));
  try {
    const complete: CatalogSnapshot = JSON.parse(await readFile('src/data/catalog.json', 'utf8'));
    complete.anime = complete.anime.map((a) => ({
      ...a,
      sourceStatus: 'released',
      releasedOn: null,
    }));
    const snapshot = await syncMaintenance({
      output: join(root, 'catalog.json'),
      reportFile: join(root, 'report.json'),
      cacheDir: join(root, 'cache'),
      previous: complete,
      now: new Date('2026-10-25T00:00:00Z'),
      api: {
        query: async () => ({
          data: {
            animes: [
              changed,
              { ...raw, id: '999999', url: 'https://shikimori.io/animes/999999-test' },
            ],
          },
        }),
      },
    });
    expect(snapshot.anime.length).toBe(complete.anime.length + 1);
    const ids = new Set(snapshot.anime.map((a) => a.id));
    expect(complete.anime.every((a) => ids.has(a.id))).toBe(true);
    const item = snapshot.anime.find((a) => a.id === old.id)!;
    expect(item.sourcePosterMainUrl).toBe(changed.poster.mainUrl);
    expect(item.sourcePosterUrl).toBe(changed.poster.originalUrl);
    expect(item.score).toBe(9.7);
    expect(item.slug).toBe(complete.anime.find((a) => a.id === old.id)!.slug);
    const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'));
    expect(report.newIds).toEqual([999999]);
    expect(report.posterChanges).toBe(1);
    expect(report.requests).toBe(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('maintenance: отказ, повреждённый пакет, пустой discovery и дубли не заменяют снимок; кеш возобновляется', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-maintenance-fail-'));
  const output = join(root, 'catalog.json');
  const config = {
    output,
    reportFile: join(root, 'report.json'),
    cacheDir: join(root, 'cache'),
    previous,
    now: new Date('2026-10-25T00:00:00Z'),
  };
  try {
    await writeFile(output, JSON.stringify(previous));
    const before = await readFile(output, 'utf8');
    let calls = 0;
    await expect(
      syncMaintenance({
        ...config,
        api: {
          query: async () => {
            if (++calls === 3) throw new Error('API offline');
            return { data: { animes: [changed] } };
          },
        },
      }),
    ).rejects.toThrow('offline');
    expect(await readFile(output, 'utf8')).toBe(before);
    calls = 0;
    const result = await syncMaintenance({
      ...config,
      api: {
        query: async () => {
          calls++;
          return { data: { animes: [changed] } };
        },
      },
    });
    expect(calls).toBe(2);
    expect(result.anime[0].score).toBe(9.7);
    const successful = await readFile(output, 'utf8');
    for (const payload of [
      { data: { animes: [{}] } },
      { data: { animes: [] } },
      { data: { animes: [changed, changed] } },
      { errors: [{ message: 'denied' }] },
    ]) {
      await expect(
        syncMaintenance({ ...config, maxAgeMs: 0, api: { query: async () => payload } }),
      ).rejects.toThrow();
      expect(await readFile(output, 'utf8')).toBe(successful);
    }
    expect(await readFile(`${output}.previous`, 'utf8')).toBe(before);
    await expect(syncMaintenance({ ...config, previous: null })).rejects.toThrow('existing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('snapshot: удаление, подмена идентичности, прав, описаний и аномальный рост блокируются', () => {
  const snapshot = structuredClone(previous);
  expect(() => assertCatalogUpdate(previous, { ...snapshot, anime: [] })).toThrow('lost ID');
  for (const patch of [
    { slug: 'renamed' },
    { internalId: 'wrong' },
    { description: 'copied text', descriptionSource: null },
    { imageSource: 'Shikimori' },
  ]) {
    expect(() =>
      assertCatalogUpdate(previous, {
        ...snapshot,
        anime: [{ ...snapshot.anime[0], ...patch }],
      } as CatalogSnapshot),
    ).toThrow();
  }
  expect(() =>
    assertCatalogUpdate(previous, { ...snapshot, anime: [snapshot.anime[0], snapshot.anime[0]] }),
  ).toThrow('Duplicate');
  expect(() =>
    assertCatalogUpdate(previous, {
      ...snapshot,
      anime: [
        ...snapshot.anime,
        ...Array.from({ length: 501 }, (_, i) => ({
          ...old,
          shikimoriId: 1000000 + i,
          id: `shikimori:${1000000 + i}`,
          internalId: `shikimori:${1000000 + i}`,
        })),
      ],
    }),
  ).toThrow('growth');
});

test('compact snapshot: сохранены все метаданные без изменения схемы', async () => {
  const snapshot: CatalogSnapshot = JSON.parse(await readFile('src/data/catalog.json', 'utf8'));
  expect(snapshot.anime.length).toBeGreaterThanOrEqual(30704);
  expect(new Set(snapshot.anime.map((a) => a.id)).size).toBe(snapshot.anime.length);
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  assertCatalogUpdate(snapshot, snapshot);
});

test('maintenance: бюджет ограничен, активные ID вращаются, повтор дня использует тот же кеш', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-maintenance-rotate-'));
  try {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      ...raw,
      id: String(100000 + i),
      url: `https://shikimori.io/animes/${100000 + i}`,
      related: [],
      status: 'ongoing',
    }));
    const previousMany = { ...previous, anime: rows.map((r) => mapAnime(r, options)) };
    const batches: string[] = [];
    const api = {
      query: async (_q: string, v: Record<string, unknown>) => {
        if (v.ids) {
          batches.push(String(v.ids));
          return { data: { animes: rows.filter((r) => String(v.ids).split(',').includes(r.id)) } };
        }
        return { data: { animes: [rows[0]] } };
      },
    };
    const config = {
      output: join(root, 'catalog.json'),
      reportFile: join(root, 'report.json'),
      cacheDir: join(root, 'cache'),
      previous: previousMany,
      now: new Date('2026-10-25T00:00:00Z'),
      budget: 50,
      api,
    };
    await syncMaintenance(config);
    const report = JSON.parse(await readFile(config.reportFile, 'utf8'));
    expect(report.batches).toBeLessThanOrEqual(50);
    expect(report.activeChecked).toBe(2250);
    expect(report.cursor).toBe(2250);
    expect(report.limitedFeeds).toContain('active-rotation');
    const requests = batches.length;
    await syncMaintenance({ ...config, state: report });
    expect(batches.length).toBe(requests);
    await syncMaintenance({ ...config, state: report, now: new Date('2026-10-26T00:00:00Z') });
    expect(batches[requests].split(',')[0]).toBe('102250');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
