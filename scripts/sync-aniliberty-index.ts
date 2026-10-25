import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { AniLibertyApi, releaseMetadataMatches } from '../src/lib/providers/video/aniliberty.ts';
import type { LibertyRelease, MatchMetadata } from '../src/lib/providers/video/aniliberty.ts';
// Explicit bounded incremental metadata sync; never run by the production build.
const args = process.argv.slice(2);
const max = Number(args.find((a) => a.startsWith('--max='))?.slice(6) || 3);
if (!Number.isInteger(max) || max < 1 || max > 10) throw Error('--max must be 1..10');
const cache = '.cache/aniliberty-index';
await mkdir(cache, { recursive: true });
const catalog = JSON.parse(await readFile('src/data/catalog.json', 'utf8')).anime as ({
  shikimoriId: number;
} & MatchMetadata)[];
const byId = new Map(catalog.map((row) => [row.shikimoriId, row]));
const seeds = JSON.parse(await readFile('src/data/aniliberty-mappings.json', 'utf8'));
const output = 'src/data/aniliberty-index.json';
const index = JSON.parse(await readFile(output, 'utf8'));
let state = {
  page: 1,
  pending: [] as LibertyRelease[],
  review: [] as { releaseId: number; shikimoriId: number; reason: string }[],
};
try {
  state = JSON.parse(await readFile(`${cache}/state.json`, 'utf8'));
} catch {}
const api = new AniLibertyApi(async (...args) => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return fetch(...args);
});
if (!state.pending.length) {
  state.pending = await api.catalogPage(state.page, 30);
  state.page++;
}
const report = {
  checkedAt: new Date().toISOString(),
  newMappings: [] as number[],
  needsReview: [] as unknown[],
  examined: 0,
};
let requests = 0;
while (state.pending.length && requests < max) {
  const candidate = state.pending.shift()!;
  report.examined++;
  const id = Number(candidate.shikimori?.id),
    target = byId.get(id);
  if (!target || seeds[id]) continue;
  if (index.mappings[id]) {
    if (index.mappings[id].releaseId !== candidate.id) {
      delete index.mappings[id];
      const review = {
        releaseId: candidate.id,
        shikimoriId: id,
        reason: 'Multiple releases for the same external ID',
      };
      state.review.push(review);
      report.needsReview.push(review);
    }
    continue;
  }
  if (state.review.some((row) => row.shikimoriId === id)) continue;
  if (!releaseMetadataMatches(candidate, target)) {
    const review = {
      releaseId: candidate.id,
      shikimoriId: id,
      reason: 'Contradictory year/format/season',
    };
    state.review.push(review);
    report.needsReview.push(review);
    continue;
  }
  requests++;
  const row = await api.release(candidate.id);
  if (
    Number(row.shikimori?.id) !== id ||
    !releaseMetadataMatches(row, target) ||
    row.is_blocked_by_geo !== false ||
    row.is_blocked_by_copyrights !== false
  )
    continue;
  const rights = JSON.parse(await readFile('src/data/video-rights.json', 'utf8'));
  const episodes = (row.episodes || []).filter(
    (e) =>
      Number.isInteger(e.ordinal) &&
      e.ordinal > 0 &&
      [e.hls_480, e.hls_720, e.hls_1080].some((value) => {
        if (!value) return false;
        try {
          const u = new URL(value);
          return (
            u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            rights.allowedPlaybackOrigins.includes(u.origin)
          );
        } catch {
          return false;
        }
      }),
  );
  if (!episodes.length) continue;
  index.mappings[id] = {
    releaseId: row.id,
    basis: 'shikimori.id',
    checkedAt: new Date().toISOString(),
    title: target.title,
    year: target.year,
    format: target.type,
  };
  await writeFile(`${cache}/release-${row.id}.json`, JSON.stringify(row));
  report.newMappings.push(id);
}
index.checkedAt = report.checkedAt;
await writeFile(output, JSON.stringify(index, null, 2) + '\n');
await writeFile(`${cache}/state.json`, JSON.stringify(state, null, 2));
await writeFile(
  `${cache}/report.json`,
  JSON.stringify(
    {
      ...report,
      requests,
      pending: state.pending.length,
      confirmed: Object.keys(index.mappings).length + Object.keys(seeds).length,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ ...report, requests, pending: state.pending.length }));
