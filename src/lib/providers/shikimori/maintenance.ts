import type { CatalogSnapshot } from '../../../types/anime.ts';
import type { SyncOptions } from './sync.ts';
import { ShikimoriApi } from './api.ts';
import { ANIME_FIELDS } from './queries.ts';
import { mapAnime, parseAnimeResponse } from './mapper.ts';
import { atomicJson, readCache, writeCache } from './cache.ts';
import { assertCatalogUpdate } from './snapshot.ts';

export const MAINTENANCE_QUERY = `query AniRezikMaintenance($page: PositiveInt, $ids: String, $season: SeasonString, $order: OrderEnum) {
  animes(page: $page, limit: 50, ids: $ids, season: $season, order: $order, censored: false) { ${ANIME_FIELDS} }
}`;
export interface MaintenanceState {
  cursor: number;
  completedDay?: string;
  startCursor?: number;
}
export interface MaintenanceReport extends MaintenanceState {
  mode: 'maintenance';
  fetchedAt: string;
  previousCount: number;
  count: number;
  newIds: number[];
  changed: number;
  posterChanges: number;
  requests: number;
  cachedBatches: number;
  batches: number;
  limitedFeeds: string[];
  activeCandidates: number;
  activeChecked: number;
}
const season = (date: Date) =>
  `${['winter', 'spring', 'summer', 'fall'][Math.floor(date.getUTCMonth() / 3)]}_${date.getUTCFullYear()}`;

/** Bounded refresh, never a replacement scan. Cache keys include the UTC day. */
export async function syncMaintenance(
  options: SyncOptions & {
    reportFile: string;
    state?: MaintenanceState;
    budget?: number;
  },
): Promise<CatalogSnapshot> {
  const previous = options.previous;
  if (!previous?.anime.length)
    throw new Error('Maintenance requires an existing snapshot; use full audit for bootstrap');
  const budget = options.budget ?? 80;
  if (!Number.isInteger(budget) || budget < 50 || budget > 100)
    throw new Error('Maintenance budget must be 50..100 batches');
  const now = options.now || new Date(),
    fetchedAt = now.toISOString(),
    day = fetchedAt.slice(0, 10);
  const base = options.base || 'https://shikimori.io';
  const api = options.api || new ShikimoriApi({ base, userAgent: options.userAgent });
  const mapped = new Map(previous.anime.map((a) => [a.shikimoriId, a]));
  const known = new Set(mapped.keys());
  const report: MaintenanceReport = {
    mode: 'maintenance',
    fetchedAt,
    previousCount: mapped.size,
    count: mapped.size,
    cursor: options.state?.cursor || 0,
    newIds: [],
    changed: 0,
    posterChanges: 0,
    requests: 0,
    cachedBatches: 0,
    batches: 0,
    limitedFeeds: [],
    activeCandidates: 0,
    activeChecked: 0,
  };
  async function batch(variables: Record<string, unknown>) {
    if (report.batches >= budget)
      throw new Error('Maintenance request budget exhausted; snapshot preserved');
    const key = JSON.stringify({
      mode: 'maintenance-v1',
      day,
      base,
      query: MAINTENANCE_QUERY,
      variables,
    });
    const cached = await readCache(options.cacheDir, key, options.maxAgeMs ?? 86400000);
    const payload = cached?.data ?? (await api.query(MAINTENANCE_QUERY, variables));
    const rows = parseAnimeResponse(payload);
    if (rows.length > 50 || new Set(rows.map((r) => Number(r.id))).size !== rows.length)
      throw new Error('Invalid maintenance batch: duplicates or oversized page');
    // Map/validate ALL rows before caching. A bad URL must not poison future resumes.
    const items = rows.map((raw) =>
      mapAnime(raw, {
        base,
        fetchedAt: cached ? new Date(cached.savedAt).toISOString() : fetchedAt,
        editorialDescriptions: options.editorialDescriptions,
      }),
    );
    if (!cached) {
      await writeCache(options.cacheDir, key, payload);
      report.requests++;
    } else report.cachedBatches++;
    report.batches++;
    for (const item of items) {
      const old = mapped.get(item.shikimoriId);
      item.isNew =
        item.year === now.getUTCFullYear() &&
        !!item.airedOn &&
        item.airedOn.length >= 7 &&
        season(new Date(`${item.airedOn.slice(0, 7)}-01`)) === season(now);
      // Identity, custom aliases/descriptions and legacy routes survive provider updates.
      if (old) {
        item.slug = old.slug;
        item.legacyIds = old.legacyIds;
        item.internalId = old.internalId;
        item.aliases = [...new Set([...item.aliases, ...old.aliases])];
        if (old.descriptionSource === 'editorial' && !item.description) {
          item.description = old.description;
          item.descriptionSource = old.descriptionSource;
        }
      }
      if (!old || Date.parse(item.fetchedAt) >= Date.parse(old.fetchedAt))
        mapped.set(item.shikimoriId, item);
    }
    await atomicJson(`${options.cacheDir}/maintenance-progress.json`, {
      day,
      variables,
      batches: report.batches,
      imported: mapped.size,
    });
    return rows;
  }
  // Recently created includes new records whose release date is historical.
  // Updated order also catches historical score/date/poster changes, within the daily window budget.
  async function feed(
    name: string,
    variables: Record<string, unknown>,
    pages: number,
    stopKnown = false,
  ) {
    for (let page = 1; page <= pages; page++) {
      const rows = await batch({ ...variables, page });
      if (page === 1 && !rows.length && !variables.season)
        throw new Error('Empty discovery response; snapshot preserved');
      if (
        rows.length < 50 ||
        (stopKnown && page >= 2 && rows.every((r) => known.has(Number(r.id))))
      )
        return;
      if (page === pages) report.limitedFeeds.push(name);
    }
  }
  await feed('created_at_desc', { order: 'created_at_desc' }, 8, true);
  await feed('updated_at_desc', { order: 'updated_at_desc' }, 8);
  const priorSeason = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  await feed(season(now), { season: season(now), order: 'id' }, 12);
  await feed(season(priorSeason), { season: season(priorSeason), order: 'id' }, 12);
  const active = previous.anime
    .filter(
      (a) =>
        ['ongoing', 'anons', 'paused'].includes(a.sourceStatus || '') ||
        (!!a.releasedOn &&
          a.releasedOn.length === 10 &&
          Date.parse(a.releasedOn) >= now.getTime() - 180 * 86400000),
    )
    .map((a) => a.shikimoriId)
    .sort((a, b) => a - b);
  report.activeCandidates = active.length;
  // Re-running a completed day replays the same cursor, not the next rotating slice.
  const start =
    options.state?.completedDay === day
      ? options.state.startCursor || 0
      : options.state?.cursor || 0;
  report.startCursor = start;
  const count = Math.min(active.length, Math.max(0, budget - report.batches - 1) * 50);
  for (let offset = 0; offset < count; offset += 50) {
    const ids = Array.from(
      { length: Math.min(50, count - offset) },
      (_, i) => active[(start + offset + i) % active.length],
    );
    const rows = await batch({ ids: ids.join(','), order: 'id' });
    if (!rows.length) throw new Error('Empty targeted response; snapshot preserved');
    if (rows.some((r) => !ids.includes(Number(r.id))))
      throw new Error('Unexpected ID in targeted response');
  }
  report.activeChecked = count;
  report.cursor = active.length ? (start + count) % active.length : 0;
  if (count < active.length) report.limitedFeeds.push('active-rotation');
  if (options.ids?.length) {
    if (options.ids.length > 50) throw new Error('At most 50 explicit IDs per maintenance run');
    const rows = await batch({ ids: options.ids.join(','), order: 'id' });
    if (!rows.length || rows.some((r) => !options.ids!.includes(Number(r.id))))
      throw new Error('Invalid explicit ID response');
  }
  const snapshot: CatalogSnapshot = {
    ...previous,
    endpoint: base,
    fetchedAt,
    anime: [...mapped.values()],
  };
  assertCatalogUpdate(previous, snapshot);
  const oldById = new Map(previous.anime.map((a) => [a.shikimoriId, a]));
  for (const a of snapshot.anime) {
    const old = oldById.get(a.shikimoriId);
    if (!old) report.newIds.push(a.shikimoriId);
    else {
      if (
        old.sourcePosterMainUrl !== a.sourcePosterMainUrl ||
        old.sourcePosterUrl !== a.sourcePosterUrl
      )
        report.posterChanges++;
      if (JSON.stringify({ ...old, fetchedAt: '' }) !== JSON.stringify({ ...a, fetchedAt: '' }))
        report.changed++;
    }
  }
  report.count = snapshot.anime.length;
  report.completedDay = day;
  await atomicJson(options.output, snapshot, true, true);
  await atomicJson(options.reportFile, report);
  return snapshot;
}
