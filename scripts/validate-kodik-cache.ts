import { readdir, readFile, access } from 'node:fs/promises';
import config from '../src/data/kodik-catalog-config.json' with { type: 'json' };
import rights from '../src/data/kodik-rights.json' with { type: 'json' };
import {
  catalogAccessReady,
  catalogPlaybackReady,
  catalogScopeAllows,
  readKodikCatalogEntry,
} from '../src/lib/providers/video/kodik-catalog-cache.ts';
import type { CatalogAnime } from './lib/kodik-catalog.ts';
if (config.apiAccessApproved || config.enabled) {
  if (!catalogAccessReady(config) || (config.enabled && !catalogPlaybackReady(config)))
    throw new Error('Kodik catalog approval/contract is incomplete');
  await access(config.permissionEvidence!);
  if (config.allowedEmbedOrigins.some((o) => !rights.allowedEmbedOrigins.includes(o)))
    throw new Error('Kodik catalog iframe origin is outside VideoRights');
}
const dir = 'public/data/video/kodik';
let files: string[] = [];
try {
  files = await readdir(dir);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const catalog = JSON.parse(await readFile('src/data/catalog.json', 'utf8')) as {
  anime: CatalogAnime[];
};
let count = 0;
let expired = 0;
for (const file of files.filter((f) => f.endsWith('.json'))) {
  if (!/^[1-9]\d*\.json$/.test(file) || !catalogPlaybackReady(config))
    throw new Error('Unapproved Kodik cache publication');
  const id = Number(file.slice(0, -5));
  const raw = JSON.parse(await readFile(`${dir}/${file}`, 'utf8'));
  const entry = readKodikCatalogEntry(raw, id, config, Date.parse(raw.fetchedAt));
  // Expiry disables the browser source; it must not prevent the next refresh or unrelated builds.
  if (Date.parse(raw.expiresAt) <= Date.now()) expired++;
  const anime = catalog.anime.find((a) => a.shikimoriId === id);
  if (
    !entry ||
    !anime ||
    !catalogScopeAllows(config, id) ||
    entry.originalTitle !== anime.originalTitle ||
    entry.year !== anime.year ||
    entry.kind !== anime.kind ||
    entry.releases.some(
      (r) => anime.episodes && r.episodes.some((e) => e.number > anime.episodes!),
    ) ||
    JSON.stringify(raw) !== JSON.stringify(entry)
  )
    throw new Error(`Invalid/stale Kodik cache: ${id}`);
  count++;
}
console.log(
  `Kodik: ${count} API cache files validated offline (${expired} expired, unavailable to the player); API integration ${config.enabled ? 'enabled' : 'disabled'}`,
);
