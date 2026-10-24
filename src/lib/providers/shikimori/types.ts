export interface IncompleteDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
  date?: string | null;
}
export interface ShikimoriAnime {
  id: string;
  name: string;
  russian: string | null;
  english: string | null;
  japanese: string | null;
  synonyms: string[];
  kind: string | null;
  status: string | null;
  rating: string | null;
  score: number | null;
  episodes: number;
  episodesAired: number;
  duration: number | null;
  airedOn: IncompleteDate | null;
  releasedOn: IncompleteDate | null;
  nextEpisodeAt: string | null;
  url: string;
  genres: { id: string; name: string; russian: string | null; kind: string }[];
  studios: { id: string; name: string }[];
  poster: { originalUrl: string; mainUrl?: string } | null;
  related: {
    relationKind: string;
    relationText: string;
    anime: { id: string; name: string; russian: string | null; url: string } | null;
  }[];
}
