import type { Anime } from '../types/anime';
export const normalizeSearch = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
export const searchText = (
  a: Pick<Anime, 'title' | 'originalTitle' | 'englishTitle' | 'japaneseTitle' | 'aliases'>,
) =>
  normalizeSearch(
    [a.title, a.originalTitle, a.englishTitle, a.japaneseTitle, ...a.aliases]
      .filter(Boolean)
      .join(' '),
  );
type Searchable = Pick<
  Anime,
  'title' | 'originalTitle' | 'englishTitle' | 'japaneseTitle' | 'aliases'
>;
// Build once per loaded snapshot, rather than normalize thousands of names per keystroke.
export function createAnimeSearch<T extends Searchable>(items: T[]) {
  const index = items.map((item) => ({
    item,
    text: searchText(item),
    exact: new Set(
      [item.title, item.originalTitle, item.englishTitle, item.japaneseTitle, ...item.aliases]
        .filter((title): title is string => Boolean(title))
        .map(normalizeSearch),
    ),
  }));
  return (query: string): T[] => {
    const q = normalizeSearch(query);
    if (!q) return items;
    const tokens = q.split(' ');
    return index
      .filter((entry) => tokens.every((token) => entry.text.includes(token)))
      .sort((a, b) => Number(b.exact.has(q)) - Number(a.exact.has(q)))
      .map((entry) => entry.item);
  };
}
export function searchAnime<
  T extends Pick<Anime, 'title' | 'originalTitle' | 'englishTitle' | 'japaneseTitle' | 'aliases'>,
>(items: T[], query: string): T[] {
  return createAnimeSearch(items)(query);
}
