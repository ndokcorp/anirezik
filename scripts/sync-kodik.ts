import { readFile, mkdir, rename, writeFile, access, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import config from '../src/data/kodik-catalog-config.json' with { type: 'json' };
import manual from '../src/data/kodik-mappings.json' with { type: 'json' };
import {
  catalogAccessReady,
  catalogPlaybackReady,
  catalogScopeAllows,
  readKodikCatalogEntry,
} from '../src/lib/providers/video/kodik-catalog-cache.ts';
import {
  KodikApiClient,
  KodikApiError,
  normalizeKodikSearch,
  safeKodikCacheJSON,
  type CatalogAnime,
} from './lib/kodik-catalog.ts';
import { queueState, runKodikQueue } from './lib/kodik-queue.ts';

async function atomic(file: string, value: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, value, 'utf8');
  await rename(`${file}.tmp`, file);
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (a) => !['--plan', '--publish-cache', '--catalog'].includes(a) && !a.startsWith('--ids='),
    )
  )
    throw new KodikApiError('unknown-option');
  if (args.filter((a) => a.startsWith('--ids=')).length > 1) throw new KodikApiError('invalid-ids');
  const rawIds = args.find((a) => a.startsWith('--ids='))?.slice(6);
  if (rawIds && args.includes('--catalog')) throw new KodikApiError('conflicting-scope');
  if (rawIds !== undefined && !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(rawIds))
    throw new KodikApiError('invalid-ids');
  const catalog = JSON.parse(await readFile('src/data/catalog.json', 'utf8')) as {
    anime: CatalogAnime[];
  };
  const ids = [
    ...new Set(
      args.includes('--catalog')
        ? catalog.anime.map((a) => a.shikimoriId)
        : rawIds
          ? rawIds.split(',').map(Number)
          : config.probeIds,
    ),
  ];
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id)))
    throw new KodikApiError('invalid-ids');
  const byId = new Map(catalog.anime.map((a) => [a.shikimoriId, a]));
  const anime = ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new KodikApiError('id-outside-catalog');
    return row;
  });
  const key = process.env.KODIK_API_TOKEN?.trim() || '';
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.includes('--plan') ? 'offline-plan' : 'api-cache',
    publicCacheFilesWritten: 0,
    catalogSize: catalog.anime.length,
    missingMetadataIds: [] as number[],
    results: [] as {
      shikimoriId: number;
      title: string;
      status: string;
      translations?: number;
      episodes?: number;
      rejected?: number;
    }[],
  };
  const reportFile = resolve('.cache/kodik-catalog/report.json');
  if (args.includes('--plan')) {
    for (const a of anime)
      report.results.push({
        shikimoriId: a.shikimoriId,
        title: a.title,
        status: Object.hasOwn(manual, `shikimori:${a.shikimoriId}`)
          ? 'confirmed-manual'
          : 'not-tested-api-access-required',
      });
    await atomic(reportFile, JSON.stringify(report, null, 2));
    console.log(
      `Kodik: offline plan for ${ids.length} IDs; no API requests; report: .cache/kodik-catalog/report.json`,
    );
    return;
  }
  // This gate precedes construction of the client, cache writes, and any network request.
  if (!catalogAccessReady(config) || !key)
    throw new KodikApiError('own-key-and-provider-contract-required');
  await access(config.permissionEvidence!);
  if (ids.some((id) => !catalogScopeAllows(config, id)))
    throw new KodikApiError('outside-approved-scope');
  const publish = args.includes('--publish-cache');
  if (publish && !catalogPlaybackReady(config))
    throw new KodikApiError('cache-publication-not-approved');
  const client = new KodikApiClient(config, key);
  const pendingPublication = new Map<number, string>();
  const stateFile = resolve('.cache/kodik-catalog/queue.json');
  let oldState: unknown;
  try {
    oldState = JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new KodikApiError('invalid-queue-checkpoint');
  }
  const state = queueState(oldState, config.approvalRevision, Date.now());
  const stage = async (
    a: CatalogAnime,
    entry: Parameters<typeof safeKodikCacheJSON>[0],
    rejected = 0,
  ) => {
    const serialized = safeKodikCacheJSON(entry, key);
    if (publish) {
      let current = '';
      try {
        current = await readFile(`public/data/video/kodik/${a.shikimoriId}.json`, 'utf8');
      } catch {
        /* New ID. */
      }
      if (current !== serialized) pendingPublication.set(a.shikimoriId, serialized);
    }
    report.results.push({
      shikimoriId: a.shikimoriId,
      title: a.title,
      status: entry.status,
      translations: entry.releases.length,
      episodes: new Set(entry.releases.flatMap((r) => r.episodes.map((e) => e.number))).size,
      rejected,
    });
  };
  const eligible = anime.filter((a) => {
    if (a.year && a.kind) return true;
    report.missingMetadataIds.push(a.shikimoriId);
    return false;
  });
  const batch = await runKodikQueue({
    anime: eligible,
    config,
    state,
    checkpoint: (s) => atomic(stateFile, JSON.stringify(s)),
    async fresh(a) {
      let cached;
      try {
        cached = readKodikCatalogEntry(
          JSON.parse(await readFile(`.cache/kodik-catalog/entries/${a.shikimoriId}.json`, 'utf8')),
          a.shikimoriId,
          config,
        );
      } catch {
        /* Invalid checkpoint is refreshed, never mistaken for not-found. */
      }
      if (
        !cached ||
        cached.originalTitle !== a.originalTitle ||
        cached.year !== a.year ||
        cached.kind !== a.kind
      )
        return false;
      await stage(a, cached);
      return true;
    },
    async query(a) {
      const result = normalizeKodikSearch(
        await client.lookupByShikimoriId(a.shikimoriId),
        a,
        config,
      );
      await atomic(
        resolve(`.cache/kodik-catalog/entries/${a.shikimoriId}.json`),
        safeKodikCacheJSON(result.entry, key),
      );
      await stage(a, result.entry, result.rejected);
    },
  });
  // Authentication/transport/validation failures above leave the previous public cache untouched.
  for (const [id, serialized] of pendingPublication) {
    await atomic(resolve(`public/data/video/kodik/${id}.json`), serialized);
    report.publicCacheFilesWritten++;
  }
  const coverage = {
    catalogIds: catalog.anime.length,
    freshProcessedIds: 0,
    kodikAnime: 0,
    providerReleases: 0,
    translationVariants: 0,
    episodeVariants: 0,
    needsReviewIds: [] as number[],
    withoutConfirmedKodik: catalog.anime.length - 1,
    manualAnimeIds: [39535],
    playbackSampleVerified: config.playbackSampleVerified,
  };
  let files: string[] = [];
  try {
    files = await readdir('public/data/video/kodik');
  } catch {
    /* No published API cache. */
  }
  for (const name of files.filter((f) => /^[1-9]\d*\.json$/.test(f))) {
    const id = Number(name.slice(0, -5));
    const raw = JSON.parse(await readFile(`public/data/video/kodik/${name}`, 'utf8'));
    const entry = readKodikCatalogEntry(raw, id, config);
    if (!entry || !byId.has(id) || !catalogScopeAllows(config, id)) {
      if (publish) await unlink(`public/data/video/kodik/${name}`);
      continue;
    }
    coverage.freshProcessedIds++;
    if (entry.status === 'needs-review') coverage.needsReviewIds.push(id);
    if (entry.status !== 'found' || Object.hasOwn(manual, `shikimori:${id}`)) continue;
    coverage.kodikAnime++;
    coverage.providerReleases += new Set(entry.releases.map((r) => r.releaseId)).size;
    coverage.translationVariants += entry.releases.length;
    coverage.episodeVariants += entry.releases.reduce((sum, r) => sum + r.episodes.length, 0);
  }
  coverage.withoutConfirmedKodik -= coverage.kodikAnime;
  if (publish)
    await atomic(
      resolve('public/data/video/kodik-coverage.json'),
      JSON.stringify({
        generatedAt: report.generatedAt,
        ...coverage,
        batch,
        totalKodikAnime: coverage.kodikAnime + 1,
      }),
    );
  if (publish) {
    const files = await readdir('public/data/video/kodik');
    await atomic(
      resolve('public/data/video/kodik-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        approvalRevision: config.approvalRevision,
        ids: files
          .filter((f) => /^[1-9]\d*\.json$/.test(f))
          .map((f) => Number(f.slice(0, -5)))
          .sort((a, b) => a - b),
      }),
    );
  }
  await atomic(reportFile, JSON.stringify({ ...report, batch, coverage }, null, 2));
  console.log(
    `Kodik: ${batch.requests} requests, ${batch.fresh} fresh checkpoints, ${batch.stopped}; sanitized report: .cache/kodik-catalog/report.json`,
  );
}
main().catch((error) => {
  // Never print an upstream error, response body, URL, environment, or fetch exception stack.
  console.error(
    error instanceof KodikApiError
      ? error.message
      : 'Kodik: validation or filesystem error; stopped without deploying the site.',
  );
  process.exitCode = 1;
});
