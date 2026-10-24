import { anime } from '../data/anime';
// Stable snapshot ranking: actual positive scores only, ID breaks equal-score ties.
export const featuredAnime = anime
  .filter((a) => a.score !== null && a.score > 0)
  .sort((a, b) => b.score! - a.score! || a.shikimoriId - b.shikimoriId)
  .slice(0, 5);
