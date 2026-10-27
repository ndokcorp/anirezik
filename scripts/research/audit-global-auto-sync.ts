import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { planIdentities } from '../lib/global-auto-sync.ts';
const load = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
const catalog = (await load('src/data/catalog.json')).anime;
const vost = await load('.cache/animevost-sync/checkpoint.json'),
  lib = await load('.cache/aniliberty-index/progress-v2.json');
const plans = {
  animevost: planIdentities('animevost', Object.values(vost.rows), catalog),
  aniliberty: planIdentities(
    'aniliberty',
    Object.values(lib.catalog).map((r: any) => ({
      ...r,
      episodeNumbers: lib.evidence[r.id]?.episodeNumbers || [],
    })),
    catalog,
  ),
};
const sourceReport = await load('src/data/auto-sync-report.json');
const baselineVost = JSON.parse(
  execFileSync('git', ['show', 'HEAD:src/data/animevost-index.json'], {
    encoding: 'utf8',
    maxBuffer: 16000000,
  }),
).mappings;
const baselineLib = JSON.parse(
  execFileSync('git', ['show', 'HEAD:src/data/aniliberty-index.json'], {
    encoding: 'utf8',
    maxBuffer: 16000000,
  }),
).mappings;
const cvh = new Set(await readdir('public/data/video/animego'));
const deferred = new Set(
  Object.values(vost.rows)
    .map((r: any) => r.id)
    .filter((id: number) => !Object.values(baselineVost).some((m: any) => m.releaseId === id)),
);
const report = {
  version: '0.5.4',
  networkRequests: 0,
  baselineDeferred: deferred.size,
  providers: Object.fromEntries(
    Object.entries(plans).map(([provider, p]) => [
      provider,
      {
        catalogRows:
          provider === 'animevost'
            ? Object.keys(vost.rows).length
            : Object.keys(lib.catalog).length,
        identifiedByBasis: p.identifiedByBasis,
        identityReady: p.candidates.length,
        reviewReasons: p.review.reduce((a: any, r: any) => {
          a[r.reason] = (a[r.reason] || 0) + 1;
          return a;
        }, {}),
        review: p.review,
      },
    ]),
  ),
  deferredAnimeVost: {
    identityReady: plans.animevost.candidates.filter((c) => deferred.has(c.releaseId)).length,
    rangeConflicts: plans.animevost.review.filter(
      (r) => deferred.has(r.releaseId) && r.reason === 'episode-range-conflict',
    ).length,
  },
  newConfirmed: sourceReport.publishedCandidates,
  newFirstProviderAnime: sourceReport.publishedCandidates
    .filter(
      (c: any) =>
        !baselineVost[c.id] && !baselineLib[c.id] && !cvh.has(`${c.id}.json`) && c.id !== 39535,
    )
    .map((c: any) => c.id),
  actualVideoProbes: sourceReport.videoResults,
  knownLimits: 'AnimeVost numeric limits not confirmed: no automated AnimeVost API schedule',
  scope: 'Matching counts are not playback counts; sample video proof stored separately',
};
await writeFile(
  'docs/diagnostics/GLOBAL_AUTO_SYNC_0.5.4.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    ...report,
    providers: Object.fromEntries(
      Object.entries(report.providers).map(([k, v]: [string, any]) => [
        k,
        { ...v, review: undefined },
      ]),
    ),
    actualVideoProbes: undefined,
  }),
);
