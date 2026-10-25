import { animeRoute } from './paths';
import type { Anime } from '../types/anime';
export type IndexRow = [
  number,
  string,
  string | null,
  string | null,
  string | null,
  string[],
  number | null,
  number | null,
  number | null,
  number,
  number,
  number[],
  number[],
  string | null,
  (string | null)?,
  number[]?,
];
export interface PackedIndex {
  version: 1;
  count: number;
  themes?: string[];
  types: string[];
  statuses: string[];
  genres: string[];
  studios: string[];
  entries: IndexRow[];
}
export interface CatalogEntry {
  ageRating?: string | null;
  themes?: string[];
  id: string;
  shikimoriId: number;
  slug: string;
  href: string;
  title: string;
  originalTitle: string;
  englishTitle: string | null;
  japaneseTitle: string | null;
  aliases: string[];
  year: number | null;
  score: number | null;
  episodes: number | null;
  type: string;
  status: string;
  genres: string[];
  studios: string[];
}
export function packIndex(items: Anime[], staticIds: Set<number>): PackedIndex {
  const types = [...new Set(items.map((a) => a.type))],
    statuses = [...new Set(items.map((a) => a.status))];
  const genres = [...new Set(items.flatMap((a) => a.genres))],
    studios = [...new Set(items.flatMap((a) => a.studios))];
  const themes = [...new Set(items.flatMap((a) => a.themes))];
  const themeIds = new Map(themes.map((v, i) => [v, i]));
  const genreIds = new Map(genres.map((g, i) => [g, i])),
    studioIds = new Map(studios.map((s, i) => [s, i]));
  return {
    version: 1,
    count: items.length,
    types,
    themes,
    statuses,
    genres,
    studios,
    entries: items.map((a) => {
      const names = new Set([a.title, a.originalTitle, a.englishTitle, a.japaneseTitle]);
      return [
        a.shikimoriId,
        a.title,
        a.originalTitle === a.title ? null : a.originalTitle,
        a.englishTitle === a.title || a.englishTitle === a.originalTitle ? null : a.englishTitle,
        a.japaneseTitle,
        a.aliases.filter((alias) => !names.has(alias)),
        a.year,
        a.score,
        a.episodes,
        types.indexOf(a.type),
        statuses.indexOf(a.status),
        a.genres.map((g) => genreIds.get(g)!),
        a.studios.map((s) => studioIds.get(s)!),
        staticIds.has(a.shikimoriId) ? a.slug : null,
        a.ageRating,
        a.themes.map((t) => themeIds.get(t)!),
      ];
    }),
  };
}
export function unpackIndex(data: PackedIndex, base: string): CatalogEntry[] {
  if (data.version !== 1 || !Array.isArray(data.entries) || data.count !== data.entries.length)
    throw new Error('Неверный индекс');
  return data.entries.map((r) => ({
    id: `shikimori:${r[0]}`,
    shikimoriId: r[0],
    slug: r[13] || `shikimori-${r[0]}`,
    href: `${base.replace(/\/$/, '')}/${animeRoute(r[0])}`,
    title: r[1],
    originalTitle: r[2] || r[1],
    englishTitle: r[3],
    japaneseTitle: r[4],
    aliases: r[5],
    year: r[6],
    score: r[7],
    episodes: r[8],
    type: data.types[r[9]],
    status: data.statuses[r[10]],
    genres: r[11].map((i) => data.genres[i]),
    studios: r[12].map((i) => data.studios[i]),
    ageRating: r[14] || null,
    themes: (r[15] || []).map((i) => data.themes?.[i]).filter((t): t is string => !!t),
  }));
}
