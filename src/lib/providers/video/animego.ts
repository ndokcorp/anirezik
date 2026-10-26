import type { VideoProvider, VideoSource } from './types';
import permission from '../../../data/animego-rights.json' with { type: 'json' };
import index from '../../../data/animego-index.json' with { type: 'json' };
import { url } from '../../paths';
const origin = 'https://animego.me';
export function approvedAnimeGoEmbed(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return (
      u.origin === origin &&
      !u.username &&
      !u.password &&
      !u.hash &&
      /^\/cdn-iframe\/[1-9]\d*(?:\/[^?#]*)?$/.test(u.pathname) &&
      [...u.searchParams.keys()].every((k) => k === 'dubbing')
    );
  } catch {
    return false;
  }
}
export function parseAnimeGoSources(input: unknown, id: number): VideoSource[] {
  const r = input as {
    version?: number;
    shikimoriId?: number;
    animegoId?: number;
    year?: number;
    format?: string;
    sourceUrl?: string;
    checkedAt?: string;
    entries?: { translationId: string; label: string; episodeNumber: number; embedUrl: string }[];
  };
  if (
    !r ||
    r.version !== 1 ||
    r.shikimoriId !== id ||
    !Number.isSafeInteger(r.animegoId) ||
    r.animegoId! < 1 ||
    !r.year ||
    r.year < 1900 ||
    r.year > 2200 ||
    !r.format ||
    !Number.isFinite(Date.parse(r.checkedAt || '')) ||
    !Array.isArray(r.entries) ||
    r.entries.length > 10000
  )
    throw Error('Invalid AnimeGO cache identity or metadata');
  const page = new URL(r.sourceUrl || '');
  if (
    page.origin !== origin ||
    page.username ||
    page.password ||
    !/^\/anime\/[a-z\d-]+-[1-9]\d*$/.test(page.pathname)
  )
    throw Error('Invalid AnimeGO attribution');
  const seen = new Set<string>();
  return r.entries.map((e) => {
    if (
      !/^animego:[1-9]\d*$/.test(e.translationId) ||
      typeof e.label !== 'string' ||
      !e.label.trim() ||
      e.label.length > 200 ||
      e.label.includes('\ufffd') ||
      !Number.isSafeInteger(e.episodeNumber) ||
      e.episodeNumber < 1 ||
      !approvedAnimeGoEmbed(e.embedUrl)
    )
      throw Error('Invalid AnimeGO episode or iframe');
    const key = e.episodeNumber + '|' + e.translationId;
    if (seen.has(key)) throw Error('Ambiguous AnimeGO translation/episode');
    seen.add(key);
    const subtitles = /субтитр/i.test(e.label);
    return {
      animeId: `shikimori:${id}`,
      episodeNumber: e.episodeNumber,
      providerId: 'animego-cvh',
      providerName: 'CVH · AnimeGO',
      audioLanguage: subtitles ? 'und' : 'ru',
      dubbingStudio: e.label,
      subtitles: subtitles ? ['ru'] : [],
      translationId: e.translationId,
      episodeId: `animego:${r.animegoId}:${e.episodeNumber}`,
      releaseId: String(r.animegoId),
      embedUrl: e.embedUrl,
      availableRegions: [],
      sourceAttribution: { label: 'AnimeGO — каталог; CVH — плеер', url: page.href },
    };
  });
}
export class AnimeGoResolver {
  private ids: ReadonlySet<number>;
  private fetcher: (id: number) => Promise<unknown>;
  private cache = new Map<number, Promise<VideoSource[]>>();
  constructor(ids: readonly number[], fetcher: (id: number) => Promise<unknown>) {
    this.ids = new Set(ids);
    this.fetcher = fetcher;
  }
  getSources(id: number): Promise<VideoSource[]> {
    if (!Number.isSafeInteger(id) || !this.ids.has(id)) return Promise.resolve([]);
    const existing = this.cache.get(id);
    if (existing) return existing;
    const pending = this.fetcher(id)
      .then((r) => parseAnimeGoSources(r, id))
      .catch((error) => {
        this.cache.delete(id);
        throw error;
      });
    if (this.cache.size >= 40) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(id, pending);
    return pending;
  }
}
const resolver = new AnimeGoResolver(index.ids, async (id) => {
  const response = await fetch(url(`data/video/animego/${id}.json`));
  if (!response.ok) throw Error('Не удалось загрузить источники AnimeGO');
  return response.json();
});
export const animeGoProvider: VideoProvider = {
  id: 'animego-cvh',
  name: 'CVH · AnimeGO',
  rights: permission,
  regionPolicy: 'iframe-enforced',
  iframePolicy: {
    allow: 'autoplay; fullscreen; picture-in-picture',
    sandbox: null,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  // No documented episode/voice state events: never forge confirmation from iframe load.
  async getSources(animeId) {
    if (typeof window === 'undefined' || !permission.verified || !permission.embeddingAllowed)
      return [];
    const id = /^shikimori:([1-9]\d*)$/.exec(animeId)?.[1];
    return id ? resolver.getSources(Number(id)) : [];
  },
};
