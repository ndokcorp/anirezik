export interface Anime {
  id: string;
  internalId: string;
  shikimoriId: number;
  legacyIds: string[];
  slug: string;
  title: string;
  originalTitle: string;
  englishTitle: string | null;
  japaneseTitle: string | null;
  aliases: string[];
  description: string;
  descriptionSource: 'editorial' | null;
  genres: string[];
  themes: string[];
  studios: string[];
  year: number | null;
  type: string;
  kind: string | null;
  status: string;
  sourceStatus: string | null;
  ageRating: string | null;
  score: number | null;
  episodes: number | null;
  episodesAired: number | null;
  duration: number | null;
  airedOn: string | null;
  releasedOn: string | null;
  nextEpisodeAt: string | null;
  poster: string;
  posterUrl?: string | null;
  posterDetailUrl?: string | null;
  posterRecoveryUrl?: string | null;
  bannerUrl?: string | null;
  backdropUrl?: string | null;
  imageSource?: string | null;
  bannerPosition?: string;
  imageAttribution?: string | null;
  imageLicenseStatus?: 'original-ai' | 'permission-granted' | 'unknown' | 'local-experiment';
  sourcePosterMainUrl?: string | null;
  banner: string;
  sourcePosterUrl: string | null;
  posterAttribution: string | null;
  popular: boolean;
  isNew: boolean;
  related: RelatedAnime[];
  sourceUrl: string;
  fetchedAt: string;
  sources: { label: string; url: string }[];
}
export interface RelatedAnime {
  shikimoriId: number;
  title: string;
  relation: string;
  relationKind: string;
  sourceUrl: string;
}
export interface CatalogSnapshot {
  schemaVersion: 2;
  source: 'shikimori';
  endpoint: string;
  fetchedAt: string;
  policy: { posters: 'placeholder'; descriptions: 'editorial-only'; popularity: 'editorial' };
  anime: Anime[];
}
