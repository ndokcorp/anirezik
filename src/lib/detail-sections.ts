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
  const items = [
    a,
    ...a.related
      .filter((r) =>
        ['prequel', 'sequel', 'side_story', 'parent_story', 'full_story', 'summary'].includes(
          r.relationKind,
        ),
      )
      .map((r) => animeByShikimoriId.get(r.shikimoriId))
      .filter((v): v is Anime => !!v),
  ];
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(
      (x, y) =>
        (x.airedOn || '9999').localeCompare(y.airedOn || '9999') || x.shikimoriId - y.shikimoriId,
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      href: url(animePath(item)),
      date: item.airedOn,
      type: item.type,
      current: item.id === a.id,
    }));
}
