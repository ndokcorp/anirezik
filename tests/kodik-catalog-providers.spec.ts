import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import config from '../src/data/kodik-catalog-config.json' with { type: 'json' };
import {
  KodikApiClient,
  normalizeKodikSearch,
  safeKodikCacheJSON,
  type CatalogAnime,
} from '../scripts/lib/kodik-catalog';
import {
  KodikStaticResolver,
  cachedKodikSources,
  readKodikCatalogEntry,
  type KodikCatalogConfig,
} from '../src/lib/providers/video/kodik-catalog-cache';

const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8')).anime as CatalogAnime[];
const anime = (id: number) => catalog.find((a) => a.shikimoriId === id)!;
const now = Date.now();
const approved = (): KodikCatalogConfig => ({
  ...config,
  enabled: true,
  apiAccessApproved: true,
  contractConfirmed: true,
  rateLimitsConfirmed: true,
  embeddingApproved: true,
  playbackSampleVerified: true,
  cachePublicationApproved: true,
  permissionEvidence: 'docs/rights/TEST_ONLY.md',
  approvalRevision: 'test-only-contract',
  reviewedAt: new Date(now).toISOString(),
  approvedAnimeIds: [...config.probeIds],
});
// Test doubles only: these made-up URLs and release IDs never enter public data.
const embed = (id: number) => `https://kodikplayer.com/seria/${id}/${'a'.repeat(32)}/720p`;
function fixture(id = 52299, translationId = 609) {
  const a = anime(id);
  return {
    total: 1,
    results: [
      {
        id: `${a.kind === 'movie' ? 'movie' : 'serial'}-999001`,
        type: a.kind === 'movie' ? 'anime' : 'anime-serial',
        shikimori_id: String(id),
        title_orig: a.originalTitle,
        year: a.year,
        material_data: { anime_kind: a.kind },
        translation: { id: translationId, title: 'Test translation', type: 'voice' },
        blocked_countries: [] as string[],
        blocked_seasons: {},
        link: a.kind === 'movie' ? embed(900001).replace('/seria/', '/video/') : embed(900001),
        seasons: { '1': { episodes: { '1': embed(900001), '5': { link: embed(900005) } } } },
      },
    ],
  };
}

test('0.4.5: API access defaults off; no browser API or static-cache requests without approval', async () => {
  let requests = 0;
  const loader = async () => {
    requests++;
    return {};
  };
  for (const c of [
    { ...config, enabled: false },
    { ...approved(), embeddingApproved: false },
    { ...approved(), cachePublicationApproved: false },
    { ...approved(), contractConfirmed: false },
    { ...approved(), rateLimitsConfirmed: false },
    { ...approved(), playbackSampleVerified: false },
  ]) {
    expect(await new KodikStaticResolver(c, loader).getSources('shikimori:52299')).toEqual([]);
  }
  expect(requests).toBe(0);
  expect(() => new KodikApiClient({ ...config, apiAccessApproved: false }, 'test-own-key')).toThrow(
    'access-not-configured',
  );
  expect(() => new KodikApiClient(approved(), '')).toThrow();
  expect(
    () => new KodikApiClient({ ...approved(), apiOrigin: 'https://example.com' }, 'test-own-key'),
  ).toThrow();
});

test('0.4.5: server search follows SDK POST query, queues and limits requests, never forwards redirects', async () => {
  const calls: { url: URL; method: string | undefined; redirect: string | undefined }[] = [];
  const client = new KodikApiClient(
    { ...approved(), maxRequestsPerRun: 2 },
    'TEST-OWN-KEY',
    (async (url, init) => {
      calls.push({
        url: new URL(String(url)),
        method: init?.method,
        redirect: init?.redirect,
      });
      return Response.json({ total: 0, results: [] });
    }) as typeof fetch,
    async () => {},
  );
  await Promise.all([client.lookupByShikimoriId(52299), client.lookupByShikimoriId(52991)]);
  expect(calls.map((c) => c.url.searchParams.get('shikimori_id'))).toEqual(['52299', '52991']);
  for (const call of calls) {
    expect(call.url.origin + call.url.pathname).toBe('https://kodik-api.com/search');
    expect(call.method).toBe('POST');
    expect(call.url.searchParams.get('token')).toBe('TEST-OWN-KEY');
    expect(call.url.searchParams.get('with_episodes')).toBe('true');
    expect(call.url.searchParams.get('with_seasons')).toBe('true');
    expect(call.redirect).toBe('error');
  }
  await expect(client.lookupByShikimoriId(9253)).rejects.toThrow('request-budget');
  expect(calls).toHaveLength(2);
});

test('0.4.5: auth/rate errors halt the queue; transport errors and JSON never expose the key', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const client = new KodikApiClient(
      approved(),
      'DO-NOT-EXPOSE',
      (async () => {
        calls++;
        return new Response('DO-NOT-EXPOSE upstream detail', { status });
      }) as typeof fetch,
      async () => {},
    );
    await expect(client.lookupByShikimoriId(52299)).rejects.toThrow(`http-${status}`);
    await expect(client.lookupByShikimoriId(52991)).rejects.toThrow('request-budget');
    expect(calls).toBe(1);
  }
  const client = new KodikApiClient(
    approved(),
    'DO-NOT-EXPOSE',
    (async () => {
      throw new Error('network URL?token=DO-NOT-EXPOSE');
    }) as typeof fetch,
    async () => {},
  );
  await expect(client.lookupByShikimoriId(52299)).rejects.toThrow('Kodik API: transport');
  const { entry } = normalizeKodikSearch(fixture(), anime(52299), approved(), now);
  expect(safeKodikCacheJSON(entry, 'DO-NOT-EXPOSE')).not.toContain('DO-NOT-EXPOSE');
  expect(() =>
    safeKodikCacheJSON({ ...entry, originalTitle: 'DO-NOT-EXPOSE' }, 'DO-NOT-EXPOSE'),
  ).toThrow('unsafe-cache');
});

test('0.4.5: eight catalog IDs cover separate seasons, a movie and OVA; only returned episode URLs are used', () => {
  expect(config.probeIds).toHaveLength(8);
  for (const id of config.probeIds) {
    const { entry } = normalizeKodikSearch(fixture(id), anime(id), approved(), now);
    expect(entry.status).toBe('found');
    expect(entry.shikimoriId).toBe(id);
    expect(entry.kind).toBe(anime(id).kind);
    expect(entry.releases[0].episodes.map((e) => e.number)).toEqual(id === 32281 ? [1] : [1, 5]);
    const sources = cachedKodikSources(entry);
    expect(
      sources.every((s) => s.animeId === `shikimori:${id}` && !s.playbackUrl && !s.qualities),
    ).toBe(true);
    expect(sources.every((s) => !s.embedUrl!.includes('?'))).toBe(true);
    if (id === 32281) expect(sources[0].seasonNumber).toBeUndefined();
  }
});

test('0.4.5: documented movie IDs and single-episode OVA keep their real format and no invented season', () => {
  const movie = normalizeKodikSearch(fixture(32281), anime(32281), approved(), now).entry;
  expect(movie.releases[0].releaseId).toBe('movie-999001');
  expect(readKodikCatalogEntry(movie, 32281, approved(), now)).not.toBeNull();
  const ova = fixture(179);
  Object.assign(ova.results[0], {
    id: 'movie-999001',
    type: 'anime',
    link: embed(900001).replace('/seria/', '/video/'),
  });
  const entry = normalizeKodikSearch(ova, anime(179), approved(), now).entry;
  expect(entry.status).toBe('found');
  expect(entry.kind).toBe('ova');
  expect(entry.releases[0].season).toBeNull();
  expect(cachedKodikSources(entry)[0].seasonNumber).toBeUndefined();
  expect(entry.releases[0].episodes.map((e) => e.number)).toEqual([1]);
  const multi = fixture(777);
  Object.assign(multi.results[0], { id: 'movie-999001', type: 'anime' });
  expect(normalizeKodikSearch(multi, anime(777), approved(), now).entry.status).toBe(
    'needs-review',
  );
});

test('0.4.5: wrong Shikimori season/format/year/remake, unknown metadata and ambiguous releases fail closed', () => {
  for (const mutate of [
    (r: ReturnType<typeof fixture>['results'][0]) => {
      r.shikimori_id = '58567';
    },
    (r: ReturnType<typeof fixture>['results'][0]) => {
      r.year = 2025;
    },
    (r: ReturnType<typeof fixture>['results'][0]) => {
      r.material_data.anime_kind = 'ova';
    },
    (r: ReturnType<typeof fixture>['results'][0]) => {
      r.title_orig = 'Other anime remake';
    },
    (r: ReturnType<typeof fixture>['results'][0]) => {
      r.type = 'anime';
    },
    (r: ReturnType<typeof fixture>['results'][0]) => {
      Object.assign(r.seasons, { '2': r.seasons['1'] });
    },
  ]) {
    const f = fixture();
    mutate(f.results[0]);
    expect(normalizeKodikSearch(f, anime(52299), approved(), now).entry.status).toBe(
      'needs-review',
    );
  }
  const f = fixture();
  f.results.push({ ...structuredClone(f.results[0]), id: 'serial-999002' });
  f.total++;
  expect(normalizeKodikSearch(f, anime(52299), approved(), now).entry.releases).toEqual([]);
  expect(
    normalizeKodikSearch(
      { ...fixture(), next_page: 'DO-NOT-FOLLOW?token=test' },
      anime(52299),
      approved(),
      now,
    ).entry.status,
  ).toBe('needs-review');
});

test('0.4.5: regions, translations and subtitles remain separate; do not invent available episodes', () => {
  const f = fixture();
  f.results[0].blocked_countries = ['RU'];
  const { entry } = normalizeKodikSearch(f, anime(52299), approved(), now);
  expect(cachedKodikSources(entry, 'RU')).toEqual([]);
  expect(cachedKodikSources(entry, 'UZ')).toHaveLength(2);
  expect(cachedKodikSources(entry)[0].availableRegions).toEqual([]); // iframe still enforces geography.
  const subtitles = fixture(52299, 870).results[0];
  subtitles.translation.type = 'subtitles';
  subtitles.translation.title = 'Test subtitles';
  subtitles.seasons['1'].episodes = { '1': embed(900011), '5': { link: embed(900015) } };
  const two = normalizeKodikSearch(
    { total: 2, results: [...f.results, subtitles] },
    anime(52299),
    approved(),
    now,
  ).entry;
  expect(two.releases.map((r) => r.type)).toEqual(['voice', 'subtitles']);
  expect(cachedKodikSources(two).filter((s) => s.subtitles.length)).toHaveLength(2);
  const missing = { total: 1, results: [{ ...f.results[0], seasons: {} }] };
  expect(normalizeKodikSearch(missing, anime(52299), approved(), now).entry.status).toBe(
    'needs-review',
  );
  expect(
    normalizeKodikSearch({ total: 0, results: [] }, anime(52299), approved(), now).entry.status,
  ).toBe('not-found');
  expect(
    normalizeKodikSearch(
      { total: 0, results: [], next_page: 'unresolved' },
      anime(52299),
      approved(),
      now,
    ).entry.status,
  ).toBe('needs-review');
  expect(() =>
    normalizeKodikSearch({ error: 'not authorized' }, anime(52299), approved(), now),
  ).toThrow();
});

test('0.4.5: reject arbitrary hosts/token-bearing URLs, stale cache and revoked approvals; deduplicate per-ID reads', async () => {
  const c = approved();
  const { entry } = normalizeKodikSearch(fixture(), anime(52299), c, now);
  for (const url of ['https://example.com/seria/1/hash/720p', `${embed(900001)}?token=secret`]) {
    const invalid = structuredClone(entry);
    invalid.releases[0].episodes[0].url = url;
    expect(readKodikCatalogEntry(invalid, 52299, c, now)).toBeNull();
  }
  expect(readKodikCatalogEntry(entry, 58567, c, now)).toBeNull();
  expect(readKodikCatalogEntry(entry, 52299, c, now + 86400001)).toBeNull();
  expect(
    readKodikCatalogEntry(entry, 52299, { ...c, approvalRevision: 'revoked' }, now),
  ).toBeNull();
  let calls = 0;
  const resolver = new KodikStaticResolver(
    c,
    async () => {
      calls++;
      return entry;
    },
    () => now,
  );
  await Promise.all([
    resolver.getSources('shikimori:52299'),
    resolver.getSources('shikimori:52299'),
  ]);
  expect(calls).toBe(1);
  expect(await resolver.getSources('shikimori:999999')).toEqual([]);
  expect(await resolver.getSources('52299')).toEqual([]);
});

test('0.4.7: CLI plan is offline; live catalog and more than ten IDs still require approved access', () => {
  const env = { ...process.env };
  delete env.KODIK_API_TOKEN;
  const plan = spawnSync(process.execPath, ['scripts/sync-kodik.ts', '--plan'], {
    env,
    encoding: 'utf8',
  });
  expect(plan.status, plan.stderr).toBe(0);
  const report = JSON.parse(readFileSync('.cache/kodik-catalog/report.json', 'utf8'));
  expect(
    report.results.filter((r: { status: string }) => r.status === 'confirmed-manual'),
  ).toHaveLength(1);
  expect(
    report.results.filter((r: { status: string }) => r.status === 'not-tested-api-access-required'),
  ).toHaveLength(7);
  const live = spawnSync(process.execPath, ['scripts/sync-kodik.ts'], { env, encoding: 'utf8' });
  expect(live.status).toBe(1);
  expect(live.stderr).toContain('own-key-and-provider-contract-required');
  const bulk = spawnSync(
    process.execPath,
    [
      'scripts/sync-kodik.ts',
      '--ids=' +
        catalog
          .slice(0, 11)
          .map((a) => a.shikimoriId)
          .join(','),
    ],
    { env, encoding: 'utf8' },
  );
  expect(bulk.status).toBe(1);
  expect(bulk.stderr).toContain('own-key-and-provider-contract-required');
  const all = spawnSync(process.execPath, ['scripts/sync-kodik.ts', '--catalog'], {
    env,
    encoding: 'utf8',
  });
  expect(all.status).toBe(1);
  expect(all.stderr).toContain('own-key-and-provider-contract-required');
});
