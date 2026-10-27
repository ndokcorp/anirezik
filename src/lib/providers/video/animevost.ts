import type { VideoProvider, VideoSource } from './types';
import permission from '../../../data/animevost-rights.json' with { type: 'json' };
import index from '../../../data/animevost-index.json' with { type: 'json' };

export interface VostMapping {
  releaseId: number;
  episodeNumbers: number[];
  kind: string;
}
const mappings: Record<string, VostMapping> = index.mappings;

// The API currently returns http URLs for this host. Upgrade only this observed
// host to its independently checked TLS endpoint; never proxy or rewrite others.
export function animeVostMedia(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.hash ||
      u.search ||
      u.hostname !== 'video.animetop.info' ||
      u.port ||
      !['http:', 'https:'].includes(u.protocol) ||
      !u.pathname.endsWith('.mp4')
    )
      return null;
    u.protocol = 'https:';
    return u.href;
  } catch {
    return null;
  }
}

export function parseAnimeVostPlaylist(
  raw: unknown,
  id: number,
  mapping: VostMapping,
): VideoSource[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 3000 ||
    !Number.isSafeInteger(mapping.releaseId) ||
    mapping.releaseId < 1 ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !['tv', 'movie', 'ova', 'ona'].includes(mapping.kind) ||
    mapping.episodeNumbers.some((n) => !Number.isSafeInteger(n) || n < 1) ||
    new Set(mapping.episodeNumbers).size !== mapping.episodeNumbers.length
  ) {
    throw Error('Invalid AnimeVost playlist');
  }
  const seen = new Set<number>();
  const sources: VideoSource[] = [];
  for (const row of raw) {
    if (!row || typeof row.name !== 'string') throw Error('Invalid AnimeVost episode');
    const match = row.name.trim().match(/^(\d+)\s+серия$/i);
    const number = match
      ? Number(match[1])
      : mapping.kind === 'movie' &&
          /^(?:фильм)$/i.test(row.name.trim()) &&
          mapping.episodeNumbers.length === 1 &&
          mapping.episodeNumbers[0] === 1
        ? 1
        : null;
    // Do not enumerate unnamed extras, trailers, OVAs or duplicates as TV episodes.
    if (!number || !mapping.episodeNumbers.includes(number)) continue;
    if (seen.has(number)) throw Error('Duplicate AnimeVost episode');
    seen.add(number);
    const qualities = (
      [
        ['SD', row.std],
        ['HD', row.hd],
      ] as const
    ).flatMap(([label, value]) => {
      const url = animeVostMedia(value);
      return url ? [{ label, url }] : [];
    });
    if (!qualities.length) continue;
    sources.push({
      animeId: `shikimori:${id}`,
      episodeNumber: number,
      episodeId: `animevost:${mapping.releaseId}:${number}`,
      releaseId: String(mapping.releaseId),
      providerId: 'animevost',
      providerName: 'AnimeVost',
      audioLanguage: 'ru',
      // The API publishes one track per episode and no separate studio roster.
      // Show the supplier name via providerName, without inventing a studio.
      dubbingStudio: null,
      translationId: 'animevost:published',
      subtitles: [],
      playbackUrl: qualities[0].url,
      qualities,
      availableRegions: [],
      sourceAttribution: { label: 'Озвучка AnimeVost · Источник ↗', url: 'https://animevost.org/' },
    });
  }
  return sources.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export class AnimeVostResolver {
  private cache = new Map<number, { expires: number; promise: Promise<VideoSource[]> }>();
  constructor(private fetcher: (release: number) => Promise<unknown>) {}
  getSources(id: number, mapping: VostMapping): Promise<VideoSource[]> {
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = this.fetcher(mapping.releaseId)
      .then((raw) => parseAnimeVostPlaylist(raw, id, mapping))
      .catch((error) => {
        this.cache.delete(id);
        throw error;
      });
    if (this.cache.size >= 30) this.cache.delete(this.cache.keys().next().value!);
    // No media URL is written to static JSON or localStorage. This short cache is
    // a client refresh policy, not a claim about the supplier's link expiry.
    this.cache.set(id, { expires: Date.now() + 5 * 60_000, promise });
    return promise;
  }
}
const resolver = new AnimeVostResolver(async (release) => {
  const response = await fetch('https://api.animevost.org/v1/playlist', {
    method: 'POST',
    body: new URLSearchParams({ id: String(release) }),
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`AnimeVost HTTP ${response.status}`);
  return response.json();
});
export const animeVostProvider: VideoProvider = {
  id: 'animevost',
  name: 'AnimeVost',
  rights: permission,
  regionPolicy: 'media-enforced',
  attributionRequired: true,
  async getSources(animeId) {
    if (typeof window === 'undefined' || !permission.verified || !permission.playbackAllowed)
      return [];
    const match = /^shikimori:([1-9]\d*)$/.exec(animeId);
    const mapping = match && mappings[match[1]];
    if (!match || !mapping) return [];
    return resolver.getSources(Number(match[1]), mapping);
  },
};
