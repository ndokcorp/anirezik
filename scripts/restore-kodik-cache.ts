import { readFile, readdir, unlink } from 'node:fs/promises';
import config from '../src/data/kodik-catalog-config.json' with { type: 'json' };
import {
  catalogPlaybackReady,
  readKodikCatalogEntry,
} from '../src/lib/providers/video/kodik-catalog-cache.ts';

// Artifact overlays cannot express deleted files. Validate the complete candidate before pruning
// old numeric JSON files. This never deletes directories or files outside the provider cache.
const root = 'public/data/video/kodik';
const manifest = JSON.parse(await readFile('public/data/video/kodik-manifest.json', 'utf8'));
if (
  !catalogPlaybackReady(config) ||
  manifest.schemaVersion !== 1 ||
  manifest.approvalRevision !== config.approvalRevision ||
  !Array.isArray(manifest.ids) ||
  manifest.ids.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) <= 0) ||
  new Set(manifest.ids).size !== manifest.ids.length
)
  throw new Error('Invalid Kodik candidate manifest');
const ids = new Set<number>(manifest.ids);
for (const id of ids) {
  const raw = JSON.parse(await readFile(`${root}/${id}.json`, 'utf8'));
  if (!readKodikCatalogEntry(raw, id, config)) throw new Error('Invalid Kodik candidate entry');
}
for (const file of await readdir(root))
  if (/^[1-9]\d*\.json$/.test(file) && !ids.has(Number(file.slice(0, -5))))
    await unlink(`${root}/${file}`);
