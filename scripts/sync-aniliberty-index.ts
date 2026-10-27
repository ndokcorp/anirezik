import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AniLibertyApi, AniLibertyHttpError } from '../src/lib/providers/video/aniliberty.ts';
import {
  newLibertyState,
  cleanLibertySummary,
  inspectLiberty,
  planLibertyDetails,
  buildLibertyIndex,
  identifyLiberty,
  validateLibertyState,
  planLibertyWithdrawals,
} from './lib/aniliberty-sync.ts';
import type { LibertySyncState, SyncAnime } from './lib/aniliberty-sync.ts';
const args = process.argv.slice(2);
if (
  args.some(
    (a) =>
      !['--refresh', '--publish-index'].includes(a) &&
      !/^--(?:max|max-requests|interval-ms)=\d+$/.test(a),
  )
)
  throw Error('Unknown sync option');
const max = Number(args.find((a) => /^--(?:max|max-requests)=/.test(a))?.split('=')[1] || 100);
const interval = Number(args.find((a) => a.startsWith('--interval-ms='))?.split('=')[1] || 1500);
if (
  !Number.isInteger(max) ||
  max < 1 ||
  max > 500 ||
  !Number.isInteger(interval) ||
  interval < 1000 ||
  interval > 60000
)
  throw Error('Invalid request budget or interval');
const cache = '.cache/aniliberty-index',
  stateFile = `${cache}/progress-v2.json`;
async function atomic(file: string, data: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', JSON.stringify(data) + '\n');
  await rename(file + '.tmp', file);
}
const anime = JSON.parse(await readFile('src/data/catalog.json', 'utf8')).anime as SyncAnime[];
const rights = JSON.parse(await readFile('src/data/video-rights.json', 'utf8'));
if (rights.status !== 'permission-granted' || !rights.playbackAllowed)
  throw Error('AniLiberty permission is required');
await access(rights.evidence);
const seeds = JSON.parse(await readFile('src/data/aniliberty-mappings.json', 'utf8'));
const prior = JSON.parse(await readFile('src/data/aniliberty-index.json', 'utf8'));
const baselineIds = [
  ...new Set([...Object.keys(prior.mappings), ...Object.keys(seeds)].map(Number)),
];
let state: LibertySyncState;
try {
  state = JSON.parse(await readFile(stateFile, 'utf8'));
  validateLibertyState(state);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  state = newLibertyState();
}
if (
  args.includes('--refresh') &&
  (state.phase === 'complete' || state.error?.message.includes('Catalog'))
) {
  const old = state.evidence,
    baseline = state.baselineMappedIds,
    previous = state.previouslyMappedIds,
    total = state.requestsTotal;
  state = newLibertyState();
  state.evidence = old;
  state.baselineMappedIds = baseline;
  state.previouslyMappedIds = previous;
  state.requestsTotal = total;
}
if (state.error && /HTTP (?:401|403)|challenge|unexpected HTML/i.test(state.error.message))
  throw Error('Saved provider access restriction: investigate before resuming; no requests sent');
const checkpoint = () => atomic(stateFile, state);
state.baselineMappedIds ||= baselineIds;
state.previouslyMappedIds = [
  ...new Set([...(state.previouslyMappedIds || []), ...baselineIds, ...(prior.excludedIds || [])]),
];
let requests = 0,
  lastRequest = 0;
class BudgetStop extends Error {}
const api = new AniLibertyApi(async (...params) => {
  if (state.resumeAfter && Date.parse(state.resumeAfter) > Date.now())
    throw Error('Provider backoff is active; resume after the recorded time');
  if (requests >= max) throw new BudgetStop();
  const wait = interval - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  requests++;
  state.requestsTotal = (state.requestsTotal || 0) + 1;
  return fetch(...params);
});
let stopped = 'complete',
  failure: unknown;
try {
  delete state.error;
  if (!state.resumeAfter || Date.parse(state.resumeAfter) <= Date.now()) delete state.resumeAfter;
  while (state.phase === 'catalog') {
    const page = await api.catalogPageResult(state.nextPage, 50);
    if (state.total !== null && state.total !== page.pagination.total)
      throw Error('Catalog total changed; preserve checkpoint and retry a fresh scan');
    state.total = page.pagination.total;
    state.totalPages = page.pagination.totalPages;
    const rows = page.data.map(cleanLibertySummary);
    state.pages[state.nextPage] = rows.map((r) => r.id);
    rows.forEach((r) => (state.catalog[r.id] = r));
    state.nextPage++;
    if (page.pagination.currentPage >= page.pagination.totalPages) planLibertyDetails(state);
    await checkpoint();
    console.log(
      `AniLiberty: catalog ${page.pagination.currentPage}/${page.pagination.totalPages}; ${Object.keys(state.catalog).length}/${state.total} unique releases`,
    );
  }
  while (state.phase === 'details' && state.pending.length) {
    const ids = state.pending.slice(0, 50);
    const rows = await api.releasesList(ids);
    for (const id of ids) {
      let row = rows.find((r) => r.id === id);
      if (!row) {
        try {
          row = await api.release(id);
        } catch (e) {
          if (!(e instanceof AniLibertyHttpError) || e.status !== 404) throw e;
          const source = state.catalog[id];
          state.evidence[id] = {
            ...inspectLiberty({ ...source, episodes: [] }, anime, rights.allowedPlaybackOrigins),
            status: 'withdrawn',
            reason: 'confirmed-404',
          };
        }
      }
      if (row) state.evidence[id] = inspectLiberty(row, anime, rights.allowedPlaybackOrigins);
      state.pending = state.pending.filter((n) => n !== id);
      await checkpoint();
    }
    console.log(
      `AniLiberty: detailed ${Object.keys(state.catalog).filter((id) => state.evidence[id]).length}/${state.total}; pending ${state.pending.length}`,
    );
  }
  if (state.phase === 'details' && !state.pending.length) {
    state.withdrawalPending ||= planLibertyWithdrawals(state, prior.mappings);
    while (state.withdrawalPending.length) {
      const releaseId = state.withdrawalPending[0];
      let reason: 'confirmed-404' | 'copyright' | undefined;
      try {
        const row = await api.release(releaseId);
        if (row.is_blocked_by_copyrights === true) reason = 'copyright';
      } catch (e) {
        if (!(e instanceof AniLibertyHttpError) || e.status !== 404) throw e;
        reason = 'confirmed-404';
      }
      if (reason) {
        state.withdrawals ||= [];
        state.withdrawals.push({ releaseId, reason, checkedAt: new Date().toISOString() });
      }
      state.withdrawalPending.shift();
      await checkpoint();
    }
  }
  if (state.phase === 'details' && !state.pending.length && !state.withdrawalPending?.length) {
    state.phase = 'complete';
    state.completedAt = new Date().toISOString();
    await checkpoint();
  }
} catch (e) {
  if (e instanceof BudgetStop) stopped = 'request-budget';
  else {
    failure = e;
    stopped = 'error';
    state.error = {
      at: new Date().toISOString(),
      message:
        e instanceof AniLibertyHttpError
          ? e.message
          : e instanceof Error
            ? e.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 180)
            : 'Transport or schema error',
      retryAfter: e instanceof AniLibertyHttpError ? e.retryAfter : null,
    };
    if (e instanceof AniLibertyHttpError && (e.status === 429 || e.status >= 500)) {
      const raw = e.retryAfter;
      const until =
        raw && /^\d+$/.test(raw) ? Date.now() + Number(raw) * 1000 : Date.parse(raw || '');
      state.resumeAfter = new Date(
        Math.max(Date.now() + 60000, Number.isFinite(until) ? until : 0),
      ).toISOString();
    }
  }
  await checkpoint();
}
const partial = {
  version: 2,
  complete: state.phase === 'complete',
  stopped,
  requestsThisRun: requests,
  requestsTotal: state.requestsTotal || 0,
  catalogPages: Object.keys(state.pages).length,
  totalCatalogPages: state.totalPages,
  totalReleases: state.total,
  processedReleases: Object.keys(state.catalog).filter((id) => state.evidence[id]).length,
  pending: state.pending.length,
  withdrawalChecksPending: state.withdrawalPending?.length || 0,
  confirmedWithdrawals: state.withdrawals?.length || 0,
  error: state.error,
  canContinue: stopped === 'request-budget',
};
if (state.phase === 'complete') {
  for (const [id, row] of Object.entries(state.catalog)) {
    const e = state.evidence[id],
      m = identifyLiberty(row, anime);
    if (e && m.reason && ['ready', 'no-hls', 'outside-catalog'].includes(e.status)) {
      e.reason = m.reason;
      e.status = m.reason === 'external-id-outside-catalog' ? 'outside-catalog' : 'needs-review';
    }
  }
  await checkpoint();
  const result = buildLibertyIndex(state, state.baselineMappedIds);
  await atomic(`${cache}/candidate/aniliberty-index.json`, result.index);
  await atomic(`${cache}/candidate/aniliberty-needs-review.json`, result.review);
  await atomic(`${cache}/candidate/aniliberty-sync-report.json`, { ...result.report, ...partial });
  if (args.includes('--publish-index')) {
    await atomic('src/data/aniliberty-index.json', result.index);
    await atomic('src/data/aniliberty-needs-review.json', result.review);
    await atomic('src/data/aniliberty-sync-report.json', { ...result.report, ...partial });
  }
}
await atomic(`${cache}/report.json`, partial);
if (process.env.GITHUB_OUTPUT)
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `complete=${partial.complete}\ncan_continue=${partial.canContinue}\n`,
    { flag: 'a' },
  );
console.log(JSON.stringify(partial));
if (failure) process.exitCode = 1;
