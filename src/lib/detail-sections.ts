// Build-only: reuse the snapshot, without network or a full catalog in detail HTML.
import { anime, animeByShikimoriId, animePath } from '../data/anime';
import type { Anime } from '../types/anime';
import { url } from './paths';
const genres = new Map<string, Anime[]>();
for (const a of anime)
  for (const genre of a.genres) {
    const group = genres.get(genre) || [];
    if (group.length < 12) group.push(a);
    genres.set(genre, group);
  }
export function similarAnime(a: Anime) {
  const found = new Map<number, Anime>();
  for (const genre of a.genres)
    for (const item of genres.get(genre) || []) {
      if (item.id !== a.id) found.set(item.shikimoriId, item);
      if (found.size === 6) return [...found.values()];
    }
  return [...found.values()];
}
export function chronology(a: Anime) {
  const items: Anime[] = [a];
  const seen = new Set([a.id]);
  // Follow only imported franchise relations, never character/alternative-setting matches.
  for (let i = 0; i < items.length && items.length < 60; i++) {
    for (const relation of items[i].related) {
      if (
        ![
          'prequel',
          'sequel',
          'side_story',
          'parent_story',
          'full_story',
          'summary',
          'spin_off',
        ].includes(relation.relationKind)
      )
        continue;
      const local = animeByShikimoriId.get(relation.shikimoriId);
      if (local && !seen.has(local.id)) {
        seen.add(local.id);
        items.push(local);
      }
      if (items.length === 60) break;
    }
  }
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(
      (x, y) =>
        (x.airedOn || '9999').localeCompare(y.airedOn || '9999') || x.shikimoriId - y.shikimoriId,
    )
    .map((item) => ({
      id: item.id,
      shikimoriId: item.shikimoriId,
      year: item.year,
      title: item.title,
      href: url(animePath(item)),
      date: item.airedOn,
      type: item.type,
      current: item.id === a.id,
    }));
}
