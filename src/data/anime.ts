import { resolveCatalogImages } from '../lib/image-policy';
import { experimentalPosters } from '../lib/image-mode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import staticIds from './static-page-ids.json' with { type: 'json' };
import type { Anime, CatalogSnapshot } from '../types/anime';
import editorial from './editorial.json' with { type: 'json' };
// Avoid asking TypeScript to infer tens of thousands of JSON record types.
export const catalog = JSON.parse(
  readFileSync(resolve('src/data/catalog.json'), 'utf8'),
) as CatalogSnapshot;
export const staticPageIds = new Set<number>(staticIds);
const staticOrder = new Map(staticIds.map((id, i) => [id, i]));
const local = editorial as Record<string, { description: string; aliases: string[] }>;
export const anime: Anime[] = catalog.anime
  .map((a) => ({
    ...a,
    ...resolveCatalogImages(a, experimentalPosters),
    aliases: [...new Set([...a.aliases, ...(local[a.shikimoriId]?.aliases || [])])],
  }))
  .sort(
    (a, b) =>
      (staticOrder.get(a.shikimoriId) ?? Infinity) - (staticOrder.get(b.shikimoriId) ?? Infinity),
  );
export const animeByShikimoriId = new Map(anime.map((a) => [a.shikimoriId, a]));
export const animePath = (a: Pick<Anime, 'shikimoriId' | 'slug'>) =>
  staticPageIds.has(a.shikimoriId) ? `anime/${a.slug}/` : `anime/?id=${a.shikimoriId}`;
const preferredGenres = ['Экшен', 'Фэнтези', 'Романтика', 'Комедия', 'Драма', 'Приключения'];
export const genres = [...new Set(anime.flatMap((a) => a.genres))].sort((a, b) => {
  const rank = (g: string) =>
    preferredGenres.includes(g) ? preferredGenres.indexOf(g) : preferredGenres.length;
  return rank(a) - rank(b) || a.localeCompare(b, 'ru');
});
