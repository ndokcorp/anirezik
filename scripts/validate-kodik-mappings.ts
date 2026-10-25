import { readFileSync, existsSync } from 'node:fs';
import {
  parseKodikMapping,
  validateKodikCatalogMetadata,
} from '../src/lib/providers/video/kodik-resolver.ts';
const rows = JSON.parse(readFileSync('src/data/kodik-mappings.json', 'utf8')) as Record<
  string,
  unknown
>;
const rights = JSON.parse(readFileSync('src/data/kodik-rights.json', 'utf8')) as {
  approvedAnimeIds: number[];
  evidence: string;
};
const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8')) as {
  anime: {
    shikimoriId: number;
    title: string;
    originalTitle: string;
    year: number | null;
    type: string;
    episodes: number | null;
  }[];
};
for (const [id, row] of Object.entries(rows)) {
  const mapping = parseKodikMapping(id, row);
  const anime = catalog.anime.find((a) => a.shikimoriId === mapping.shikimoriId);
  validateKodikCatalogMetadata(mapping, anime);
  if (
    !rights.approvedAnimeIds.includes(mapping.shikimoriId) ||
    mapping.permissionEvidence !== rights.evidence ||
    !existsSync(mapping.permissionEvidence)
  )
    throw new Error(`${id}: rights evidence missing`);
}
console.log(`Kodik: ${Object.keys(rows).length} exact mappings validated offline`);
