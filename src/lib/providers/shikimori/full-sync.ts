import type { Anime, CatalogSnapshot } from '../../../types/anime.ts';
import { ShikimoriApi } from './api.ts';
import { ANIME_FIELDS } from './queries.ts';
import { parseAnimeResponse, mapAnime } from './mapper.ts';
import { readCache, writeCache, atomicJson } from './cache.ts';
import type { SyncOptions } from './sync.ts';
import { assertCatalogUpdate } from './snapshot.ts';

export const FULL_QUERY = `query AniRezikFull($page: PositiveInt, $ids: String) {
  animes(page: $page, limit: 50, ids: $ids, order: id, censored: false) { ${ANIME_FIELDS} }
}`;
export const AUDIT_QUERY = `query AniRezikAudit($page: PositiveInt) {
  animes(page: $page, limit: 50, order: id_desc, censored: false) { id }
}`;
export interface CoverageReport {
  startedAt: string;
  firstResponseAt?: string;
  lastResponseAt?: string;
  finishedAt?: string;
  status: 'running' | 'verified' | 'failed';
  phase: string;
  page: number;
  discovered: number;
  imported: number;
  retainedPrevious: number;
  unresolvedIds: number[];
  forwardOnlyIds: number[];
  referencedUnavailableIds: number[];
  duplicates: number;
  networkRequests: number;
  cachedBatches: number;
  scope: string;
  error?: string;
}
export async function syncFullCatalog(
  options: SyncOptions & { reportFile: string; maxPages?: number },
) {
  const base = options.base || 'https://shikimori.io';
  const api =
    options.api ||
    new ShikimoriApi({
      base,
      userAgent: options.userAgent || 'AniRezik/0.3.0 (noncommercial metadata catalog)',
    });
  const now = options.now || new Date();
  const report: CoverageReport = {
    startedAt: now.toISOString(),
    status: 'running',
    phase: 'metadata',
    page: 0,
    discovered: 0,
    imported: 0,
    retainedPrevious: 0,
    unresolvedIds: [],
    forwardOnlyIds: [],
    referencedUnavailableIds: [],
    duplicates: 0,
    networkRequests: 0,
    cachedBatches: 0,
    scope:
      'Official GraphQL animes; censored:false; all kinds/statuses/years; accessible to this unauthenticated client. Not a claim about hidden/deleted records.',
  };
  const mapped = new Map<number, Anime>();
  const maxPages = options.maxPages ?? 2000;
  async function batch(query: string, variables: Record<string, unknown>) {
    const key = JSON.stringify({ base, query, variables });
    const cached = await readCache(options.cacheDir, key, options.maxAgeMs ?? 604800000);
    function noteDate(timestamp: number) {
      const date = new Date(timestamp).toISOString();
      if (!report.firstResponseAt || date < report.firstResponseAt) report.firstResponseAt = date;
      if (!report.lastResponseAt || date > report.lastResponseAt) report.lastResponseAt = date;
      return date;
    }
    if (cached) {
      report.cachedBatches++;
      return { payload: cached.data, date: noteDate(cached.savedAt) };
    }
    const payload = await api.query(query, variables);
    if (query === FULL_QUERY) parseAnimeResponse(payload);
    else auditIds(payload);
    const timestamp = Date.now();
    await writeCache(options.cacheDir, key, payload, timestamp);
    report.networkRequests++;
    return { payload, date: noteDate(timestamp) };
  }
  async function checkpoint() {
    report.imported = mapped.size;
    console.log(
      `${report.phase}: page ${report.page}; imported ${mapped.size}; discovered ${report.discovered}; API ${report.networkRequests}; cache ${report.cachedBatches}`,
    );
    // Keep fast cached replay checkpoints outside the source tree / dev file watcher.
    await atomicJson(
      report.status === 'running' ? `${options.cacheDir}/full-progress.json` : options.reportFile,
      report,
    );
  }
  function add(payload: unknown, date: string) {
    for (const row of parseAnimeResponse(payload)) {
      const item = mapAnime(row, {
        base,
        fetchedAt: date,
        editorialDescriptions: options.editorialDescriptions,
      });
      item.isNew =
        row.airedOn?.year === now.getUTCFullYear() &&
        row.airedOn.month != null &&
        Math.floor((row.airedOn.month - 1) / 3) === Math.floor(now.getUTCMonth() / 3);
      mapped.set(item.shikimoriId, item);
    }
  }
  try {
    let previousId = 0,
      ended = false;
    for (let page = 1; page <= maxPages; page++) {
      report.page = page;
      const { payload, date } = await batch(FULL_QUERY, { page });
      const rows = parseAnimeResponse(payload);
      for (const row of rows) {
        const id = Number(row.id);
        if (id <= previousId) report.duplicates++;
        previousId = id;
      }
      add(payload, date);
      await checkpoint();
      if (rows.length < 50) {
        ended = true;
        break;
      }
    }
    if (!ended || mapped.size < 100)
      throw new Error('Forward scan incomplete or too small; snapshot preserved');
    const verified = new Set<number>();
    report.phase = 'reverse-id-audit';
    ended = false;
    let lastId = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= maxPages; page++) {
      report.page = page;
      const { payload } = await batch(AUDIT_QUERY, { page });
      const ids = auditIds(payload);
      for (const id of ids) {
        if (id >= lastId || verified.has(id))
          throw new Error('Reverse scan is not strictly ordered; restart with fresh audit cache');
        verified.add(id);
        lastId = id;
      }
      report.discovered = verified.size;
      await checkpoint();
      if (ids.length < 50) {
        ended = true;
        break;
      }
    }
    if (!ended || verified.size < 100)
      throw new Error('Reverse audit incomplete; snapshot preserved');
    const missing = [...verified].filter((id) => !mapped.has(id));
    report.phase = 'repair';
    for (let i = 0; i < missing.length; i += 50) {
      const { payload, date } = await batch(FULL_QUERY, {
        ids: missing.slice(i, i + 50).join(','),
      });
      add(payload, date);
    }
    report.unresolvedIds = [...verified].filter((id) => !mapped.has(id));
    report.forwardOnlyIds = [...mapped.keys()].filter((id) => !verified.has(id));
    if (report.unresolvedIds.length || report.forwardOnlyIds.length || report.duplicates)
      throw new Error(
        'Catalog changed during scan or contains gaps/duplicates; review coverage report and refresh affected cache',
      );
    report.phase = 'related-id-audit';
    const attempted = new Set<number>();
    while (true) {
      const referenced = [
        ...new Set([...mapped.values()].flatMap((a) => a.related.map((r) => r.shikimoriId))),
      ];
      const candidates = referenced
        .filter((id) => !mapped.has(id) && !attempted.has(id))
        .slice(0, 50);
      if (!candidates.length) break;
      if (attempted.size >= 5000)
        throw new Error('Too many unresolved references; review audit before continuing');
      candidates.forEach((id) => attempted.add(id));
      const { payload, date } = await batch(FULL_QUERY, { ids: candidates.join(',') });
      add(payload, date);
      await checkpoint();
    }
    report.referencedUnavailableIds = [...attempted].filter((id) => !mapped.has(id));
    report.discovered = mapped.size;
    if (options.previous && mapped.size < options.previous.anime.length * 0.95)
      throw new Error('Unexpected coverage decrease >5%; snapshot preserved for manual review');
    for (const old of options.previous?.anime || [])
      if (!mapped.has(old.shikimoriId)) {
        mapped.set(old.shikimoriId, old);
        report.retainedPrevious++;
      }
    const snapshot: CatalogSnapshot = {
      schemaVersion: 2,
      source: 'shikimori',
      endpoint: base,
      fetchedAt: new Date().toISOString(),
      policy: { posters: 'placeholder', descriptions: 'editorial-only', popularity: 'editorial' },
      anime: [...mapped.values()],
    };
    if (options.previous) assertCatalogUpdate(options.previous, snapshot);
    await atomicJson(options.output, snapshot, true, true);
    report.status = 'verified';
    report.phase = 'complete';
    report.finishedAt = new Date().toISOString();
    await checkpoint();
    return snapshot;
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    await checkpoint();
    throw error;
  }
}
function auditIds(payload: unknown): number[] {
  const value = payload as { errors?: unknown; data?: { animes?: { id: string }[] } };
  if (!value || value.errors || !Array.isArray(value.data?.animes))
    throw new Error('Invalid audit response');
  return value.data.animes.map((row) => {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid audit ID');
    return id;
  });
}
