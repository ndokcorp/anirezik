import { test, expect } from '@playwright/test';
import {
  AniLibertyApi,
  AniLibertyHttpError,
  type LibertyRelease,
} from '../src/lib/providers/video/aniliberty';
import {
  newLibertyState,
  cleanLibertySummary,
  inspectLiberty,
  planLibertyDetails,
  buildLibertyIndex,
  validateLibertyState,
  type SyncAnime,
} from '../scripts/lib/aniliberty-sync';
import fixture from './fixtures/aniliberty.json' with { type: 'json' };
const source = fixture.find((r) => r.shikimori?.id === 52299)! as LibertyRelease;
const anime: SyncAnime[] = [
  {
    shikimoriId: 52299,
    title: source.name.main,
    originalTitle: source.name.english || source.name.main,
    year: source.year,
    type: source.type.value,
  },
];
const origins = ['https://cache-rfn.libria.fun'];
const row: LibertyRelease = {
  ...source,
  episodes: [
    {
      id: 'fixture-episode',
      ordinal: 1.5,
      duration: 50,
      updated_at: source.updated_at,
      hls_480: 'https://cache-rfn.libria.fun/test.m3u8',
    },
  ],
};
test('full sync preserves fractional episodes, exact IDs and excludes remakes, unsafe HLS, missing flags', () => {
  expect(inspectLiberty(row, anime, origins)).toMatchObject({
    status: 'ready',
    episodeCount: 1,
    fractionalEpisodes: 1,
    qualities: [480],
  });
  expect(inspectLiberty({ ...row, year: 1999 }, anime, origins).status).toBe('needs-review');
  expect(inspectLiberty({ ...row, type: { value: 'MOVIE' } }, anime, origins).status).toBe(
    'needs-review',
  );
  expect(inspectLiberty({ ...row, shikimori: null }, anime, origins).status).toBe('needs-review');
  expect(inspectLiberty({ ...row, is_blocked_by_geo: true }, anime, origins).status).toBe(
    'blocked',
  );
  expect(
    inspectLiberty({ ...row, is_blocked_by_geo: undefined as unknown as boolean }, anime, origins)
      .status,
  ).toBe('needs-review');
  expect(
    inspectLiberty(
      { ...row, episodes: [{ ...row.episodes![0], hls_480: 'https://evil.test/a' }] },
      anime,
      origins,
    ).status,
  ).toBe('no-hls');
  expect(
    inspectLiberty({ ...row, episodes: [...row.episodes!, ...row.episodes!] }, anime, origins)
      .reason,
  ).toContain('duplicate');
});
test('checkpoint resumes, validates complete pagination and refreshes changed or stale metadata', () => {
  const s = newLibertyState();
  s.catalog[row.id] = cleanLibertySummary(row);
  s.pages[1] = [row.id];
  s.total = 1;
  s.totalPages = 1;
  s.evidence[row.id] = inspectLiberty(row, anime, origins);
  planLibertyDetails(s);
  expect(s.pending).toEqual([]);
  s.catalog[row.id].updated_at = '2026-10-27T00:00:00Z';
  planLibertyDetails(s);
  expect(s.pending).toEqual([row.id]);
  const saved = JSON.parse(JSON.stringify(s));
  validateLibertyState(saved);
  expect(saved.pending).toEqual([row.id]);
  saved.catalog[row.id].episodes = row.episodes;
  expect(() => validateLibertyState(saved)).toThrow('Unsanitized');
  s.total = 2;
  expect(() => planLibertyDetails(s)).toThrow('Catalog changed');
  expect(() => buildLibertyIndex(s, [])).toThrow('incomplete');
});
test('multiple valid release IDs stay quarantined; no HLS stored in index or checkpoint', () => {
  const s = newLibertyState();
  for (const r of [row, { ...row, id: 999999 }]) {
    s.catalog[r.id] = cleanLibertySummary(r);
    s.evidence[r.id] = inspectLiberty(r, anime, origins);
  }
  s.total = 2;
  s.totalPages = 1;
  s.pages[1] = [row.id, 999999];
  s.phase = 'complete';
  s.completedAt = new Date().toISOString();
  const result = buildLibertyIndex(s, []);
  expect(result.index.mappings).toEqual({});
  expect(result.review).toHaveLength(2);
  expect(result.index.excludedIds).toContain(52299);
  expect(JSON.stringify(s)).not.toContain('m3u8');
  expect(JSON.stringify(result.index)).not.toContain('hls');
});
test('official pagination and batch envelopes are required; HTTP errors retain Retry-After', async () => {
  const envelope = {
    data: [row],
    meta: { pagination: { total: 1, current_page: 1, total_pages: 1, per_page: 50 } },
  };
  const api = new AniLibertyApi(async () => new Response(JSON.stringify(envelope)));
  expect((await api.catalogPageResult(1)).pagination.total).toBe(1);
  expect((await api.releasesList([row.id]))[0].id).toBe(row.id);
  await expect(
    new AniLibertyApi(async () => new Response(JSON.stringify([row]))).catalogPageResult(1),
  ).rejects.toThrow('paginated');
  await expect(
    new AniLibertyApi(
      async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    ).catalogPageResult(1),
  ).rejects.toMatchObject({ status: 429, retryAfter: '120' });
  expect(new AniLibertyHttpError(403).message).toBe('AniLiberty HTTP 403');
  await expect(api.releasesList([123])).rejects.toThrow('batch');
});
