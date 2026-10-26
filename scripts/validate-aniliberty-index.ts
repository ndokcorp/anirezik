import { readFile } from 'node:fs/promises';
const load = async (name: string) => JSON.parse(await readFile(`src/data/${name}.json`, 'utf8'));
const [index, report, review, catalog] = await Promise.all(
  ['aniliberty-index', 'aniliberty-sync-report', 'aniliberty-needs-review', 'catalog'].map(load),
);
const known = new Set(catalog.anime.map((a: { shikimoriId: number }) => a.shikimoriId));
if (
  index.version !== 2 ||
  !report.complete ||
  report.totalReleases !== report.processedReleases ||
  report.remainingReleases !== 0 ||
  report.catalogPages !== report.totalCatalogPages ||
  Object.keys(index.mappings).length !== report.matchedAnime ||
  review.length !== report.needsReview
)
  throw Error('Incomplete AniLiberty coverage report');
const releases = new Set<number>();
for (const [id, value] of Object.entries(index.mappings)) {
  const m = value as { releaseId: number; basis: string; checkedAt: string; malId?: number };
  if (
    !/^\d+$/.test(id) ||
    !known.has(Number(id)) ||
    !Number.isSafeInteger(m.releaseId) ||
    m.releaseId < 1 ||
    releases.has(m.releaseId) ||
    !['shikimori.id', 'mal.id'].includes(m.basis) ||
    !Number.isFinite(Date.parse(m.checkedAt)) ||
    Object.keys(m).some((k) => !['releaseId', 'basis', 'checkedAt', 'malId'].includes(k))
  )
    throw Error('Invalid AniLiberty mapping');
  releases.add(m.releaseId);
}
if (!Array.isArray(index.excludedIds) || index.excludedIds.some((id: number) => index.mappings[id]))
  throw Error('Conflicting AniLiberty exclusion');
if (/https?:|hls_\d|playbackUrl/i.test(JSON.stringify(index)))
  throw Error('Playback URLs must not be published in the static index');
console.log(
  `AniLiberty index valid: ${releases.size} anime; ${report.processedReleases}/${report.totalReleases} releases`,
);
