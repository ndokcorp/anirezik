import type { VideoProvider, VideoSource } from './types';
import type { AvailabilityAdapter } from './updates';
export interface LibertyEpisode {
  id: string;
  ordinal: number;
  duration: number | null;
  updated_at: string;
  hls_480?: string | null;
  hls_720?: string | null;
  hls_1080?: string | null;
}
export interface LibertyRelease {
  id: number;
  year: number;
  name: { main: string; english?: string; alternative?: string };
  type: { value: string };
  shikimori?: { id: number } | null;
  is_blocked_by_geo: boolean;
  is_blocked_by_copyrights: boolean;
  updated_at: string;
  episodes?: LibertyEpisode[];
}
export const libertyMappings = [
  { shikimoriId: 52991, releaseId: 9542, episodes: 28 },
  { shikimoriId: 9253, releaseId: 8674, episodes: 25 },
  { shikimoriId: 52299, releaseId: 9600, episodes: 12 },
] as const;
// Multiple exact matches are deliberately unresolved. Title-only results require manual review.
export function exactRelease(rows: LibertyRelease[], shikimoriId: number) {
  const matches = rows.filter((row) => Number(row.shikimori?.id) === shikimoriId);
  return matches.length === 1 ? matches[0] : null;
}
export class AniLibertyApi {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string): Promise<T> {
    if (!/^\/(app\/search\/releases\?|anime\/releases(?:\/|\?))/.test(path))
      throw new Error('Unsupported endpoint');
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.at < 300_000) return cached.value as T;
    const response = await this.fetcher(`https://anilibria.top/api/v1${path}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`AniLiberty HTTP ${response.status}`);
    const value: unknown = await response.json();
    this.cache.set(path, { at: Date.now(), value });
    return value as T;
  }
  search(query: string) {
    return this.request<LibertyRelease[]>(
      `/app/search/releases?query=${encodeURIComponent(query)}`,
    );
  }
  release(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid release');
    return this.request<LibertyRelease>(`/anime/releases/${id}`);
  }
  latest() {
    return this.request<LibertyRelease[]>('/anime/releases/latest?limit=10');
  }
}
const api = new AniLibertyApi();
export const aniLibertyProvider: VideoProvider = {
  id: 'aniliberty',
  name: 'AniLiberty',
  rights: {
    verified: false,
    embeddingAllowed: false,
    playbackAllowed: false,
    termsUrl: 'https://aniliberty.top/rules',
    reviewedAt: '',
    allowedEmbedOrigins: [],
    allowedPlaybackOrigins: [],
  },
  async getSources(animeId): Promise<VideoSource[]> {
    // Support ticket T53925 has no documented positive response. No requests before approval.
    if (!this.rights.verified || !this.rights.playbackAllowed) return [];
    const mapping = libertyMappings.find((item) => animeId === `shikimori:${item.shikimoriId}`);
    if (!mapping) return [];
    const row = await api.release(mapping.releaseId);
    if (
      row.id !== mapping.releaseId ||
      !exactRelease([row], mapping.shikimoriId) ||
      row.is_blocked_by_geo !== false ||
      row.is_blocked_by_copyrights !== false
    )
      return [];
    return (row.episodes || []).flatMap((episode) => {
      const qualities = [480, 720, 1080].flatMap((height) => {
        const value = episode[`hls_${height}` as keyof LibertyEpisode];
        return typeof value === 'string' && value ? [{ label: `${height}p`, url: value }] : [];
      });
      if (!qualities.length || !Number.isFinite(episode.ordinal) || episode.ordinal <= 0) return [];
      return [
        {
          animeId,
          episodeNumber: episode.ordinal,
          episodeId: episode.id,
          releaseId: String(row.id),
          providerId: this.id,
          providerName: this.name,
          audioLanguage: 'Русский',
          dubbingStudio: 'AniLiberty',
          subtitles: [],
          qualities,
          playbackUrl: qualities.at(-1)!.url,
          // Country must come from a documented availability decision, never from a guessed locale.
          availableRegions: [],
          sourceAttribution: {
            label: 'AniLiberty',
            url: `https://aniliberty.top/anime/releases/${row.id}`,
          },
        },
      ];
    });
  },
};
// A local reconciliation cursor, not an invented AniLiberty change-feed cursor.
// All three known mappings are rechecked, so removals cannot be hidden by a short latest feed.
export const aniLibertyAvailabilityAdapter: AvailabilityAdapter = {
  ...aniLibertyProvider,
  async getUpdates(_cursor) {
    if (!this.rights.verified || !this.rights.playbackAllowed)
      throw new Error('AniLiberty permission is pending');
    const sources: VideoSource[] = [];
    for (const mapping of libertyMappings)
      sources.push(...(await this.getSources(`shikimori:${mapping.shikimoriId}`)));
    return {
      cursor: new Date().toISOString(),
      sources,
      replaceAnimeIds: libertyMappings.map((mapping) => `shikimori:${mapping.shikimoriId}`),
    };
  },
};
