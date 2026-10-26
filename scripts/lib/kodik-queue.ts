import type { KodikCatalogConfig } from '../../src/lib/providers/video/kodik-catalog-cache.ts';
import type { CatalogAnime } from './kodik-catalog.ts';
import { KodikApiError } from './kodik-catalog.ts';

export interface KodikQueueState {
  schemaVersion: 1;
  revision: string;
  nextId: number | null;
  quotaDay: string;
  requestsToday: number;
  lastRequestAt: number;
}
export function queueState(raw: unknown, revision: string, now: number): KodikQueueState {
  const row = raw as Partial<KodikQueueState> | null;
  const valid = row?.schemaVersion === 1;
  if (
    raw !== undefined &&
    (!valid ||
      typeof row.quotaDay !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.quotaDay) ||
      !Number.isSafeInteger(row.requestsToday) ||
      Number(row.requestsToday) < 0 ||
      !Number.isFinite(row.lastRequestAt))
  )
    throw new KodikApiError('invalid-queue-checkpoint');
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    schemaVersion: 1,
    revision,
    nextId:
      valid && row.revision === revision && Number.isSafeInteger(row.nextId) ? row.nextId! : null,
    quotaDay: day,
    // Approval changes must not reset an already consumed daily quota.
    requestsToday:
      valid && row.quotaDay === day && Number.isSafeInteger(row.requestsToday)
        ? Math.max(0, row.requestsToday!)
        : 0,
    lastRequestAt: valid && Number.isFinite(row.lastRequestAt) ? row.lastRequestAt! : 0,
  };
}
/** Sequential, durable round robin. Each ID is visited at most once in a batch. */
export async function runKodikQueue(options: {
  anime: CatalogAnime[];
  config: KodikCatalogConfig;
  state: KodikQueueState;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  fresh: (anime: CatalogAnime) => Promise<boolean>;
  query: (anime: CatalogAnime) => Promise<void>;
  checkpoint: (state: KodikQueueState) => Promise<void>;
  maxDurationMs?: number;
}) {
  const { config, state } = options;
  const now = options.now || Date.now;
  const wait = options.wait || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rows = [...new Map(options.anime.map((a) => [a.shikimoriId, a])).values()].sort(
    (a, b) => a.shikimoriId - b.shikimoriId,
  );
  const started = now();
  let cursor = Math.max(
    0,
    rows.findIndex((a) => a.shikimoriId === state.nextId),
  );
  let visited = 0,
    requests = 0,
    fresh = 0;
  let stopped: 'complete-pass' | 'batch-budget' | 'daily-budget' | 'time-budget' = 'complete-pass';
  while (visited < rows.length) {
    if (now() - started >= (options.maxDurationMs ?? 45 * 60 * 1000)) {
      stopped = 'time-budget';
      break;
    }
    const anime = rows[cursor];
    state.nextId = anime.shikimoriId;
    if (await options.fresh(anime)) fresh++;
    else {
      if (requests >= config.maxRequestsPerRun) {
        stopped = 'batch-budget';
        break;
      }
      const day = new Date(now()).toISOString().slice(0, 10);
      if (state.quotaDay !== day) {
        state.quotaDay = day;
        state.requestsToday = 0;
      }
      if (state.requestsToday >= config.maxRequestsPerDay) {
        stopped = 'daily-budget';
        break;
      }
      await wait(Math.max(0, state.lastRequestAt + config.minRequestIntervalMs - now()));
      state.requestsToday++;
      state.lastRequestAt = now();
      // Reserve quota before the request. A crash/failure cannot silently reset the budget.
      await options.checkpoint(state);
      requests++;
      await options.query(anime); // Any error stops; cursor still points at the failed ID.
    }
    visited++;
    cursor = (cursor + 1) % rows.length;
    state.nextId = rows[cursor]?.shikimoriId ?? null;
    await options.checkpoint(state);
  }
  return { visited, requests, fresh, stopped, nextId: state.nextId };
}
