import { resolveImages } from '../src/lib/images';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from './fixtures/shikimori.json' with { type: 'json' };
import {
  mapAnime,
  parseAnimeResponse,
  validateApiAnime,
  PLACEHOLDER,
} from '../src/lib/providers/shikimori/mapper';
import { ShikimoriApi } from '../src/lib/providers/shikimori/api';
import { syncCatalog } from '../src/lib/providers/shikimori/sync';
import { refreshAvailability } from '../src/lib/providers/video/updates';
import { syncFullCatalog, FULL_QUERY, AUDIT_QUERY } from '../src/lib/providers/shikimori/full-sync';
import { packIndex, unpackIndex } from '../src/lib/catalog-index';
import { searchAnime, normalizeSearch, createAnimeSearch } from '../src/lib/search';
import { safeJson } from '../src/lib/serialize';
import { isAuthorizedSource, getVideoSources } from '../src/lib/providers/video';
import type { VideoProvider, VideoSource } from '../src/lib/providers/video/types';
const options = { base: 'https://shikimori.io', fetchedAt: '2026-10-24T00:00:00Z' };
test('фиксированный настоящий ответ API преобразуется без выдуманных полей', () => {
  const rows = parseAnimeResponse(fixture);
  expect(rows).toHaveLength(3);
  const a = mapAnime(rows[0], options);
  expect(a.id).toBe('shikimori:52299');
  expect(a.slug).toBe('solo-leveling');
  expect(a.title).toBe(rows[0].russian);
  expect(a.score).toBe(rows[0].score);
  expect(a.studios).toContain('A-1 Pictures');
  expect(a.episodesAired).toBe(rows[0].episodesAired);
  expect(a.description).toBe('');
  expect(a.sourceUrl).toContain('shikimori.io/animes/');
  expect(a.related.some((r) => r.relationKind === 'sequel')).toBeTruthy();
});
test('нулевые/отсутствующие оценки и постеры, неполные даты и неизвестные эпизоды', () => {
  for (const score of [0, null]) {
    const raw = {
      ...fixture.data.animes[0],
      score,
      poster: null,
      airedOn: { year: 2024, month: null, day: null, date: null },
      episodes: 0,
    };
    const mapped = mapAnime(raw, options);
    expect(mapped.score).toBeNull();
    expect(mapped.poster).toBe(PLACEHOLDER);
    expect(mapped.sourcePosterUrl).toBeNull();
    expect(mapped.airedOn).toBe('2024');
    expect(mapped.episodes).toBeNull();
  }
});
test('повреждённая схема и GraphQL errors отвергаются; пустой ответ отличим', () => {
  expect(
    resolveImages(1, {
      '1': {
        posterUrl: 'https://example.com/x.webp',
        imageLicenseStatus: 'unknown',
        evidence: '',
        imageAttribution: '',
      },
    }).posterUrl,
  ).toBeNull();
  const title = '</script><script>alert(1)</script>';
  expect(safeJson([title])).not.toContain('<');
  expect(JSON.parse(safeJson([title]))).toEqual([title]);
  expect(() => validateApiAnime({ id: 'broken' })).toThrow();
  expect(() => parseAnimeResponse({ errors: [{ message: 'forbidden' }] })).toThrow();
  expect(() => parseAnimeResponse({ data: { animes: [{ id: 1 }] } })).toThrow();
  expect(parseAnimeResponse({ data: { animes: [] } })).toEqual([]);
  expect(() =>
    mapAnime({ ...fixture.data.animes[0], url: 'javascript:alert(1)' }, options),
  ).toThrow();
});
test('поиск кириллицей, английским, оригинальным и альтернативным названием', () => {
  const rows = fixture.data.animes.map((a) => mapAnime(a, options));
  expect(searchAnime(rows, '  поднятие   УРОВНЯ ')).toHaveLength(1);
  expect(searchAnime(rows, 'SOLO LEVELING')[0].shikimoriId).toBe(52299);
  expect(searchAnime(rows, 'Ore dake')[0].shikimoriId).toBe(52299);
  const alias = rows[0].aliases.find((a) => a !== rows[0].englishTitle);
  if (alias) expect(searchAnime(rows, alias)).toContain(rows[0]);
  expect(normalizeSearch('  Ёж— ЁЖ  ')).toBe('еж еж');
  const find = createAnimeSearch(rows);
  for (const query of ['поднятие уровня', 'Ore dake', 'SOLO LEVELING', '不存在', ''])
    expect(find(query)).toEqual(searchAnime(rows, query));
});
test('HTTP 429 учитывает Retry-After; временная ошибка повторяется', async () => {
  const pauses: number[] = [];
  let calls = 0;
  const api = new ShikimoriApi({
    intervalMs: 0,
    sleep: async (ms) => {
      pauses.push(ms);
    },
    fetcher: async () =>
      ++calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
        : Response.json(fixture),
  });
  expect(await api.query('query')).toEqual(fixture);
  expect(calls).toBe(2);
  expect(pauses).toContain(2000);
});
test('HTTP 403 не повторяется; не-JSON и тайм-аут корректно завершают запрос', async () => {
  let calls = 0;
  const api = new ShikimoriApi({
    intervalMs: 0,
    fetcher: async () => {
      calls++;
      return new Response('', { status: 403 });
    },
  });
  await expect(api.query('query')).rejects.toThrow('403');
  expect(calls).toBe(1);
  await expect(
    new ShikimoriApi({ fetcher: async () => new Response('<html>') }).query('query'),
  ).rejects.toThrow('JSON');
  await expect(
    new ShikimoriApi({
      retries: 1,
      intervalMs: 0,
      sleep: async () => {},
      fetcher: async () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    }).query('query'),
  ).rejects.toThrow('timeout');
});
test('слишком большой Retry-After прекращает обновление без раннего повтора', async () => {
  const api = new ShikimoriApi({
    fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  });
  await expect(api.query('query')).rejects.toThrow('позже');
});
test('импорт дедуплицирует 120 записей, кеширует, обновляет атомарно и сохраняет прежний каталог при ошибке', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-sync-'));
  const output = join(root, 'catalog.json');
  const cacheDir = join(root, 'cache');
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...fixture.data.animes[0],
    id: String(100000 + i),
    url: `https://shikimori.io/animes/${100000 + i}`,
  }));
  // This test checks a fresh cache: its timestamp must not expire with the calendar.
  const now = new Date();
  let calls = 0;
  const api = {
    query: async () => {
      calls++;
      return { data: { animes: rows } };
    },
  };
  try {
    const snapshot = await syncCatalog({
      output,
      cacheDir,
      api,
      now,
    });
    expect(snapshot.anime).toHaveLength(120);
    expect(new Set(snapshot.anime.map((a) => a.id)).size).toBe(120);
    const before = await readFile(output, 'utf8');
    const beforeCalls = calls;
    await syncCatalog({ output, cacheDir, api, now });
    expect(calls).toBe(beforeCalls);
    await expect(
      syncCatalog({
        output,
        cacheDir,
        maxAgeMs: 0,
        api: {
          query: async () => {
            throw new Error('offline');
          },
        },
      }),
    ).rejects.toThrow('offline');
    expect(await readFile(output, 'utf8')).toBe(before);
    await expect(
      syncCatalog({
        output,
        cacheDir,
        maxAgeMs: 0,
        api: { query: async () => ({ data: { animes: [] } }) },
      }),
    ).rejects.toThrow('Пустой');
    expect(await readFile(output, 'utf8')).toBe(before);
    expect(await readFile(`${output}.previous`, 'utf8')).toBe(before);
    for (const name of await readdir(cacheDir)) {
      const file = join(cacheDir, name);
      const cached = JSON.parse(await readFile(file, 'utf8'));
      cached.savedAt = Date.now() - 2 * 86400000;
      await writeFile(file, JSON.stringify(cached));
    }
    const refreshed = await syncCatalog({
      output,
      cacheDir,
      api: {
        query: async () => ({ data: { animes: rows.map((row) => ({ ...row, score: 9.5 })) } }),
      },
    });
    // Fresh daily responses must not be overwritten by an older weekly ranked cache.
    expect(refreshed.anime.every((item) => item.score === 9.5)).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('прерванный импорт продолжает с кеша и сохраняет старые страницы', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-resume-'));
  const output = join(root, 'catalog.json');
  const cacheDir = join(root, 'cache');
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...fixture.data.animes[0],
    id: String(100000 + i),
    url: `https://shikimori.io/animes/${100000 + i}`,
  }));
  const config = { output, cacheDir, maxTitles: 150 };
  try {
    await writeFile(output, 'previous snapshot');
    let calls = 0;
    await expect(
      syncCatalog({
        ...config,
        api: {
          query: async () => {
            if (++calls === 3) throw new Error('interrupted');
            return { data: { animes: rows } };
          },
        },
      }),
    ).rejects.toThrow('interrupted');
    expect(await readFile(output, 'utf8')).toBe('previous snapshot');
    expect(await readdir(cacheDir)).toHaveLength(2);
    const old = mapAnime(fixture.data.animes[0], options);
    calls = 0;
    const resumed = await syncCatalog({
      ...config,
      previous: {
        schemaVersion: 2,
        source: 'shikimori',
        endpoint: options.base,
        fetchedAt: options.fetchedAt,
        policy: { posters: 'placeholder', descriptions: 'editorial-only', popularity: 'editorial' },
        anime: [old],
      },
      api: {
        query: async () => {
          calls++;
          return { data: { animes: rows } };
        },
      },
    });
    expect(calls).toBe(4); // Six planned batches, two already persisted.
    expect(resumed.anime).toHaveLength(121);
    expect(resumed.anime.find((a) => a.id === old.id)?.slug).toBe('solo-leveling');
    for (const maxTitles of [NaN, 3000.5, 5001, 0])
      await expect(syncCatalog({ ...config, maxTitles })).rejects.toThrow('целым');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('полный импорт: возобновление, обратная сверка и безопасная публикация', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-full-'));
  const output = join(root, 'catalog.json'),
    reportFile = join(root, 'coverage.json');
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...fixture.data.animes[0],
    id: String(100000 + i),
    url: `https://shikimori.io/animes/${100000 + i}`,
    related: [],
  }));
  let interrupt = true;
  const config = {
    output,
    reportFile,
    cacheDir: join(root, 'cache'),
    maxPages: 10,
    api: {
      query: async (query: string, variables: Record<string, unknown>) => {
        if (query === FULL_QUERY && variables.page === 2 && interrupt)
          throw new Error('interrupted');
        const ordered = query === AUDIT_QUERY ? [...rows].reverse() : rows;
        const page = Number(variables.page || 1);
        return { data: { animes: ordered.slice((page - 1) * 50, page * 50) } };
      },
    },
  };
  try {
    await writeFile(output, 'unchanged');
    await expect(syncFullCatalog(config)).rejects.toThrow('interrupted');
    expect(await readFile(output, 'utf8')).toBe('unchanged');
    interrupt = false;
    const result = await syncFullCatalog(config);
    expect(result.anime).toHaveLength(120);
    const audit = JSON.parse(await readFile(reportFile, 'utf8'));
    expect(audit).toMatchObject({
      status: 'verified',
      discovered: 120,
      imported: 120,
      cachedBatches: 1,
      networkRequests: 5,
      unresolvedIds: [],
      forwardOnlyIds: [],
    });
    const before = await readFile(output, 'utf8');
    await expect(
      syncFullCatalog({
        ...config,
        cacheDir: join(root, 'broken-cache'),
        api: {
          query: async (query, variables = {}) => {
            const ordered = query === AUDIT_QUERY ? [...rows.slice(1)].reverse() : rows;
            const page = Number(variables.page || 1);
            return { data: { animes: ordered.slice((page - 1) * 50, page * 50) } };
          },
        },
      }),
    ).rejects.toThrow('gaps/duplicates');
    expect(await readFile(output, 'utf8')).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('полный импорт восстанавливает пропуск по обнаруженным ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anirezik-gap-'));
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...fixture.data.animes[0],
    id: String(100000 + i),
    url: `https://shikimori.io/animes/${100000 + i}`,
    related: [],
  }));
  try {
    const result = await syncFullCatalog({
      output: join(root, 'catalog.json'),
      reportFile: join(root, 'audit.json'),
      cacheDir: join(root, 'cache'),
      api: {
        query: async (query, variables = {}) => {
          if (variables.ids)
            return {
              data: {
                animes: rows.filter((row) => String(variables.ids).split(',').includes(row.id)),
              },
            };
          if (query === FULL_QUERY) {
            const page = Number(variables.page || 1);
            return {
              data: { animes: rows.filter((_, i) => i !== 110).slice((page - 1) * 50, page * 50) },
            };
          }
          const page = Number(variables.page);
          return { data: { animes: [...rows].reverse().slice((page - 1) * 50, page * 50) } };
        },
      },
    });
    expect(result.anime).toHaveLength(120);
    expect(new Set(result.anime.map((a) => a.id)).size).toBe(120);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('компактный индекс сохраняет языки/алиасы/фильтры и оба вида маршрутов без подробных текстов', () => {
  const items = fixture.data.animes.map((raw) => mapAnime(raw, options));
  const packed = packIndex(items, new Set([52299]));
  const restored = unpackIndex(packed, '/anirezik/');
  for (const item of items) {
    const result = restored.find((row) => row.id === item.id)!;
    expect(result.genres).toEqual(item.genres);
    expect(result.studios).toEqual(item.studios);
    expect(result.ageRating).toEqual(item.ageRating);
    for (const query of [
      item.title,
      item.originalTitle,
      item.englishTitle,
      item.japaneseTitle,
      ...item.aliases,
    ].filter((q): q is string => !!q))
      expect(searchAnime(restored, query).map((a) => a.id)).toContain(item.id);
  }
  expect(restored.find((a) => a.shikimoriId === 52299)!.href).toBe('/anirezik/anime/52299/');
  expect(restored.find((a) => a.shikimoriId !== 52299)!.href).toMatch(/\/anirezik\/anime\/\d+\//);
  expect(JSON.stringify(packed)).not.toMatch(
    /description|sourcePosterUrl|related|https:\/\/shikimori/,
  );
  const legacy = { ...packed, entries: packed.entries.map((row) => row.slice(0, 14)) };
  expect(unpackIndex(legacy as typeof packed, '/')[0].ageRating).toBeNull();
});
const provider: VideoProvider = {
  id: 'official-test',
  name: 'Official Test',
  rights: {
    verified: true,
    embeddingAllowed: true,
    playbackAllowed: false,
    termsUrl: 'https://official.example/terms',
    reviewedAt: '2026-10-24',
    allowedEmbedOrigins: ['https://official.example'],
    allowedPlaybackOrigins: [],
  },
  getSources: async () => [],
};
const source: VideoSource = {
  animeId: 'shikimori:52299',
  episodeNumber: 1,
  providerId: provider.id,
  providerName: provider.name,
  audioLanguage: 'ru',
  dubbingStudio: null,
  subtitles: ['ru'],
  embedUrl: 'https://official.example/embed/1',
  availableRegions: ['UZ'],
  sourceAttribution: { label: 'Test', url: 'https://official.example/title/1' },
};
test('плеер допускает только проверенные источники и разрешённые регионы/хосты', async () => {
  expect(await getVideoSources(source.animeId)).toEqual([]);
  expect(isAuthorizedSource(source, provider)).toBe(false);
  expect(isAuthorizedSource(source, provider, 'UZ')).toBe(true);
  expect(
    isAuthorizedSource(
      { ...source, embedUrl: 'https://official.example.evil.test/embed' },
      provider,
      'UZ',
    ),
  ).toBe(false);
  expect(
    isAuthorizedSource(
      source,
      { ...provider, rights: { ...provider.rights, verified: false } },
      'UZ',
    ),
  ).toBe(false);
  expect(isAuthorizedSource({ ...source, embedUrl: 'javascript:alert(1)' }, provider, 'UZ')).toBe(
    false,
  );
  expect(
    await getVideoSources(source.animeId, 'UZ', [
      { ...provider, getSources: async () => [source] },
    ]),
  ).toHaveLength(1);
});
test('обновления видеопровайдера отделены от Shikimori, проверяют права и сохраняют прежние данные при отказе', async () => {
  const previous = { providerId: provider.id, cursor: 'one', sources: [source], checkedAt: null };
  const adapter = {
    ...provider,
    getUpdates: async () => ({
      cursor: 'two',
      sources: [{ ...source, episodeNumber: 2, dubbingStudio: 'Test voice' }],
    }),
  };
  const next = await refreshAvailability(adapter, previous, 'UZ');
  expect(next.sources).toHaveLength(2);
  expect(next.cursor).toBe('two');
  expect(previous.sources).toHaveLength(1);
  await expect(
    refreshAvailability(
      { ...adapter, rights: { ...adapter.rights, verified: false } },
      previous,
      'UZ',
    ),
  ).rejects.toThrow('approved');
  await expect(refreshAvailability(adapter, previous, 'RU')).rejects.toThrow('Invalid');
  await expect(
    refreshAvailability(
      {
        ...adapter,
        getUpdates: async () => {
          throw new Error('offline');
        },
      },
      previous,
      'UZ',
    ),
  ).rejects.toThrow('offline');
  expect(previous.cursor).toBe('one');
});

import {
  aniLibertyProvider,
  aniLibertyAvailabilityAdapter,
  exactRelease,
  libertyMappings,
  type LibertyRelease,
} from '../src/lib/providers/video/aniliberty';
import { demoProvider } from '../src/lib/providers/video/demo';
test('0.4.0: точные ID AniLiberty, неоднозначность и сборка без API', async () => {
  const rows = libertyMappings.map(
    (m) => ({ id: m.releaseId, shikimori: { id: m.shikimoriId } }) as LibertyRelease,
  );
  expect(exactRelease([...rows].reverse(), 9253)?.id).toBe(8674);
  expect(
    exactRelease(
      [
        rows.find((r) => r.shikimori?.id === 52991)!,
        { ...rows.find((r) => r.shikimori?.id === 52991)!, id: 12345 },
      ],
      52991,
    ),
  ).toBeNull();
  expect(exactRelease(rows, 1)?.id).toBe(8443);
  expect(exactRelease(rows, 99999999)).toBeNull();
  expect(await aniLibertyProvider.getSources('shikimori:52991')).toEqual([]);
  await expect(aniLibertyAvailabilityAdapter.getUpdates(null)).rejects.toThrow('Browser session');
  expect(await demoProvider.getSources('shikimori:52991')).toEqual([]);
  const demo = (await demoProvider.getSources('demo:player'))[0];
  expect(isAuthorizedSource(demo, demoProvider)).toBe(true);
  expect(
    isAuthorizedSource(
      { ...demo, qualities: [{ label: '1080p', url: 'https://evil.example/stream' }] },
      demoProvider,
    ),
  ).toBe(false);
});
test('0.4.0: полная сверка удаляет отозванные серии только после успешной проверки', async () => {
  const previous = { providerId: provider.id, cursor: 'one', sources: [source], checkedAt: null };
  const replaced = await refreshAvailability(
    {
      ...provider,
      getUpdates: async () => ({ cursor: 'two', sources: [], replaceAnimeIds: [source.animeId] }),
    },
    previous,
    'UZ',
  );
  expect(replaced.sources).toEqual([]);
  expect(previous.sources).toHaveLength(1);
  await expect(
    refreshAvailability(
      {
        ...provider,
        getUpdates: async () => ({ cursor: 'two', sources: [], replaceAnimeIds: ['bad'] }),
      },
      previous,
      'UZ',
    ),
  ).rejects.toThrow('Invalid');
});

import libertyFixture from './fixtures/aniliberty.json' with { type: 'json' };
import { strictTitleCandidates } from '../src/lib/providers/video/aniliberty';
test('0.4.1: пять точных тайтлов, сезоны и фильм не подменяются', () => {
  const rows = libertyFixture as LibertyRelease[];
  for (const [shikimoriId, releaseId] of [
    [52991, 9542],
    [9253, 8674],
    [52299, 9600],
    [58567, 9839],
    [32281, 6826],
  ])
    expect(exactRelease([...rows].reverse(), shikimoriId)?.id).toBe(releaseId);
  expect(
    exactRelease(
      rows.filter((r) => r.id === 9839),
      52299,
    ),
  ).toBeNull();
  expect(
    exactRelease(
      rows.filter((r) => r.id === 9313),
      40748,
    ),
  ).toBeNull();
  const candidate = {
    ...rows[0],
    shikimori: null,
    mal: null,
    year: 2025,
    type: { value: 'TV' },
    name: { main: 'Example Season 2', english: 'Example Season 2' },
  };
  const target = {
    title: 'Example Season 2',
    originalTitle: 'Example Season 2',
    year: 2025,
    type: 'TV',
  };
  expect(strictTitleCandidates([candidate], target)).toHaveLength(1);
  expect(strictTitleCandidates([candidate], { ...target, type: 'MOVIE' })).toHaveLength(0);
  expect(
    strictTitleCandidates([candidate], {
      ...target,
      originalTitle: 'Example Season 1',
      title: 'Example Season 1',
    }),
  ).toHaveLength(0);
  expect(strictTitleCandidates([candidate], { ...target, year: 2024 })).toHaveLength(0);
  expect(
    isAuthorizedSource(
      { ...source, availableRegions: [], regionChecked: true },
      { ...provider, regionPolicy: 'provider-response' },
    ),
  ).toBe(true);
  expect(
    isAuthorizedSource(
      { ...source, availableRegions: [], regionChecked: false },
      { ...provider, regionPolicy: 'provider-response' },
    ),
  ).toBe(false);
});

import { releaseMetadataMatches } from '../src/lib/providers/video/aniliberty';
test('0.4.6: official ID does not override remake/year/format contradictions', () => {
  const row = {
    id: 10294,
    year: 2011,
    name: { main: 'Hunter x Hunter (2011)' },
    type: { value: 'TV' },
    shikimori: { id: 136 },
  } as LibertyRelease;
  const target = {
    title: 'Hunter x Hunter',
    originalTitle: 'Hunter x Hunter',
    year: 1999,
    type: 'TV',
  };
  expect(releaseMetadataMatches(row, target)).toBe(false);
  expect(releaseMetadataMatches({ ...row, year: 1999 }, target)).toBe(true);
  expect(releaseMetadataMatches({ ...row, year: 1999, type: { value: 'MOVIE' } }, target)).toBe(
    false,
  );
});
