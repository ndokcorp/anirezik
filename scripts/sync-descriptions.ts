import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ShikimoriApi } from '../src/lib/providers/shikimori/api.ts';
import { readCache, writeCache, atomicJson } from '../src/lib/providers/shikimori/cache.ts';
import { descriptionText } from '../src/lib/description-text.ts';

const sources = JSON.parse(await readFile('src/data/description-sources.json', 'utf8'));
if (sources.shikimori.status !== 'permission-granted' || !sources.shikimori.evidence)
  throw new Error('Description permission must be documented before import');
await readFile(sources.shikimori.evidence);
const catalog = JSON.parse(await readFile('src/data/catalog.json', 'utf8')) as {
  anime: { shikimoriId: number }[];
};
const ids = catalog.anime.map((a) => a.shikimoriId).sort((a, b) => a - b);
if (new Set(ids).size !== ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1))
  throw new Error('Invalid/duplicate catalog IDs');
const cacheDir = '.cache/shikimori-descriptions';
await mkdir(cacheDir, { recursive: true });
const query =
  'query AniRezikDescriptions($ids: String!) { animes(ids: $ids, limit: 50, censored: false) { id description } }';
const api = new ShikimoriApi({
  userAgent:
    process.env.SHIKIMORI_USER_AGENT ||
    'AniRezik/0.3.10 (https://ndokcorp.github.io/anirezik/; noncommercial descriptions import)',
  intervalMs: 1100,
});
const records: Record<string, { text: string; sourceUrl: string; fetchedAt: string }> = {};
const missing: number[] = [],
  empty: number[] = [],
  oversized: number[] = [];
let requests = 0,
  cached = 0;
for (let offset = 0; offset < ids.length; offset += 50) {
  const batch = ids.slice(offset, offset + 50),
    variables = { ids: batch.join(',') };
  const key = createHash('sha256')
    .update(query + JSON.stringify(variables))
    .digest('hex');
  const hit = await readCache(cacheDir, key, 7 * 86400000);
  const raw = hit ? hit.data : await api.query(query, variables);
  const result = raw as {
    data?: { animes?: { id: string; description: string | null }[] };
    errors?: unknown[];
  };
  if (result.errors?.length || !Array.isArray(result.data?.animes))
    throw new Error('Invalid GraphQL description response');
  const rows = result.data.animes,
    seen = new Set<number>();
  for (const row of rows) {
    const id = Number(row.id);
    if (
      !batch.includes(id) ||
      seen.has(id) ||
      (row.description !== null && typeof row.description !== 'string')
    )
      throw new Error('Unexpected or duplicate description ID/schema');
    seen.add(id);
  }
  if (!hit) {
    await writeCache(cacheDir, key, raw);
    requests++;
  } else cached++;
  const fetchedAt = new Date(hit?.savedAt || Date.now()).toISOString();
  for (const id of batch) if (!seen.has(id)) missing.push(id);
  for (const row of rows) {
    const text = descriptionText(row.description),
      id = Number(row.id);
    if (!text) {
      empty.push(id);
      continue;
    }
    if (text.length > 20000) {
      oversized.push(id);
      continue;
    }
    records[id] = { text, sourceUrl: `https://shikimori.io/animes/${id}`, fetchedAt };
  }
  if ((offset / 50) % 10 === 0 || offset + 50 >= ids.length) {
    const progress = {
      processed: Math.min(offset + 50, ids.length),
      total: ids.length,
      descriptions: Object.keys(records).length,
      requests,
      cached,
    };
    await atomicJson(`${cacheDir}/progress.json`, progress);
    console.log(JSON.stringify(progress));
  }
}
await atomicJson('src/data/shikimori-descriptions.json', records, true, true);
await atomicJson('src/data/description-coverage.json', {
  source: 'Shikimori',
  catalogCount: ids.length,
  available: Object.keys(records).length,
  missing,
  empty,
  oversized,
  requests,
  cached,
  completedAt: new Date().toISOString(),
  evidence: sources.shikimori.evidence,
});
console.log(`Description snapshot saved atomically: ${Object.keys(records).length}/${ids.length}`);
