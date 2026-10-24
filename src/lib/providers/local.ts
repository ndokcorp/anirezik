import { anime } from '../../data/anime';
import { searchAnime } from '../search';
export const animeProvider = {
  getAll: () => anime,
  getBySlug: (slug: string) => anime.find((item) => item.slug === slug),
  search: (query: string) => {
    return searchAnime(anime, query);
  },
};
