import type { VideoProvider, VideoSource } from './types';
import type { AvailabilityAdapter } from './updates';
import seeds from '../../../data/aniliberty-mappings.json' with { type: 'json' };
import indexed from '../../../data/aniliberty-index.json' with { type: 'json' };
const mappings = { ...seeds, ...indexed.mappings };
const excludedLibertyIds = new Set<number>(
  (indexed as { excludedIds?: number[] }).excludedIds || [],
);
import permission from '../../../data/video-rights.json' with { type: 'json' };
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
  mal?: { id: number } | null;
  is_blocked_by_geo: boolean;
  is_blocked_by_copyrights: boolean;
  updated_at: string;
  episodes?: LibertyEpisode[];
  fresh_at?: string;
  is_ongoing?: boolean;
}
export interface MatchMetadata {
  title: string;
  originalTitle: string;
  englishTitle?: string | null;
  aliases?: string[];
  year: number | null;
  type: string;
  malId?: number;
}
export class AniLibertyHttpError extends Error {
  status: number;
  retryAfter: string | null;
  constructor(status: number, retryAfter: string | null = null) {
    super(`AniLiberty HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export interface LibertyPage {
  data: LibertyRelease[];
  pagination: { total: number; currentPage: number; totalPages: number; perPage: number };
}
export const libertyIndexFields =
  'id,type,year,name,shikimori,mal,updated_at,fresh_at,is_ongoing,is_blocked_by_geo,is_blocked_by_copyrights';
const libertyEpisodeFields =
  'episodes.id,episodes.ordinal,episodes.updated_at,episodes.duration,episodes.release_id,episodes.hls_480,episodes.hls_720,episodes.hls_1080';
function parseLibertyPage(raw: unknown, page: number): LibertyPage {
  const value = raw as { data?: LibertyRelease[]; meta?: { pagination?: Record<string, number> } };
  const p = value?.meta?.pagination;
  if (
    !Array.isArray(value?.data) ||
    !p ||
    p.current_page !== page ||
    !Number.isSafeInteger(p.total) ||
    p.total < 0 ||
    !Number.isSafeInteger(p.total_pages) ||
    p.total_pages < 1 ||
    !Number.isSafeInteger(p.per_page) ||
    p.per_page < 1 ||
    value.data.length > p.per_page ||
    value.data.some((r) => !r || !Number.isSafeInteger(r.id) || r.id < 1 || !r.name || !r.type)
  )
    throw new Error('Invalid AniLiberty paginated response');
  return {
    data: value.data,
    pagination: {
      total: p.total,
      currentPage: p.current_page,
      totalPages: p.total_pages,
      perPage: p.per_page,
    },
  };
}
interface Mapping {
  releaseId: number;
  basis: string;
  checkedAt: string;
  malId?: number;
}
export const libertyMappings = Object.entries(mappings).map(([id, m]) => ({
  shikimoriId: Number(id),
  ...m,
}));
const mappingKey = 'anirezik:aniliberty-mappings:v1';
const metadata = new Map<string, MatchMetadata>();
export function setLibertyMetadata(animeId: string, data: MatchMetadata) {
  metadata.set(animeId, data);
}
export function exactRelease(rows: LibertyRelease[], shikimoriId: number, malId?: number) {
  const matches = rows.filter(
    (row) =>
      Number(row.shikimori?.id) === shikimoriId ||
      (!row.shikimori?.id && !!malId && Number(row.mal?.id) === malId),
  );
  const unique = [...new Map(matches.map((r) => [r.id, r])).values()];
  return unique.length === 1 ? unique[0] : null;
}
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const season = (names: string[]) => {
  const values = new Set(
    names.flatMap((name) =>
      [...name.matchAll(/(?:season|сезон|part|часть)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season/gi)].map(
        (m) => Number(m[1] || m[2]),
      ),
    ),
  );
  return values.size === 1 ? [...values][0] : null;
};
const format = (value: string) =>
  ({ Фильм: 'MOVIE', 'ТВ-сериал': 'TV', Спецвыпуск: 'SPECIAL', 'TV Special': 'SPECIAL' })[value] ||
  value.toUpperCase();
/** An official external ID does not override contradictory remake/year/format metadata. */
export function releaseMetadataMatches(row: LibertyRelease, target?: MatchMetadata) {
  if (!target) return true;
  if (target.year && row.year && target.year !== row.year) return false;
  if (target.type && row.type?.value && format(target.type) !== format(row.type.value))
    return false;
  const targetSeason = season([
    target.title,
    target.originalTitle,
    target.englishTitle || '',
    ...(target.aliases || []),
  ]);
  const otherSeason = season([row.name.main, row.name.english || '', row.name.alternative || '']);
  return targetSeason === null || otherSeason === null || targetSeason === otherSeason;
}
export function strictTitleCandidates(rows: LibertyRelease[], target: MatchMetadata) {
  const names = [target.originalTitle, target.englishTitle || '', ...(target.aliases || [])].filter(
    Boolean,
  );
  const targetSeason = season([...names, target.title]);
  // Missing season is not proof of season 1. Such matches stay manual.
  if (!target.year || targetSeason === null) return [];
  return rows.filter((row) => {
    if (row.shikimori?.id || row.mal?.id) return false;
    const other = [row.name.english || '', row.name.alternative || '', row.name.main].filter(
      Boolean,
    );
    return (
      row.year === target.year &&
      format(row.type.value) === format(target.type) &&
      season(other) === targetSeason &&
      names.some((name) => other.some((n) => normalize(n) === normalize(name)))
    );
  });
}
function storedMappings(): Record<string, Mapping> {
  try {
    const value = JSON.parse(localStorage.getItem(mappingKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([id, item]) => {
        const m = item as Mapping;
        return (
          /^\d+$/.test(id) &&
          m &&
          Number.isSafeInteger(m.releaseId) &&
          m.releaseId > 0 &&
          ['shikimori.id', 'mal.id', 'metadata'].includes(m.basis) &&
          Number.isFinite(Date.parse(m.checkedAt)) &&
          Date.now() - Date.parse(m.checkedAt) < 30 * 86400_000
        );
      }),
    ) as Record<string, Mapping>;
  } catch {
    return {};
  }
}
function remember(id: number, row: LibertyRelease, basis: string) {
  try {
    const saved = storedMappings();
    saved[id] = { releaseId: row.id, basis, checkedAt: new Date().toISOString() };
    if (Number.isSafeInteger(row.mal?.id)) saved[id].malId = row.mal!.id;
    localStorage.setItem(
      mappingKey,
      JSON.stringify(Object.fromEntries(Object.entries(saved).slice(-500))),
    );
  } catch {
    /* The verified seed and memory cache still work. */
  }
}
export class AniLibertyApi {
  private cache = new Map<string, { at: number; value: unknown }>();
  private inFlight = new Map<string, Promise<unknown>>();
  private tail: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.fetcher = fetcher;
  }
  request<T>(path: string, envelope = false): Promise<T> {
    if (
      !/^\/(app\/search\/releases\?|anime\/catalog\/releases\?|anime\/releases(?:\/|\?))/.test(path)
    )
      return Promise.reject(new Error('Unsupported endpoint'));
    const key = `${path}${envelope ? '#envelope' : ''}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 180_000) return Promise.resolve(cached.value as T);
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const delay = 400 - (Date.now() - this.lastRequest);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastRequest = Date.now();
        const response = await this.fetcher(`https://anilibria.top/api/v1${path}`, {
          signal: AbortSignal.timeout(12_000),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok)
          throw new AniLibertyHttpError(response.status, response.headers.get('retry-after'));
        const raw: unknown = await response.json();
        const value =
          !envelope && raw && typeof raw === 'object' && 'data' in raw
            ? (raw as { data: unknown }).data
            : raw;
        this.cache.set(key, { at: Date.now(), value });
        if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.tail = task;
    this.inFlight.set(key, task);
    return task as Promise<T>;
  }
  async search(query: string) {
    const rows = await this.request<unknown>(
      `/app/search/releases?query=${encodeURIComponent(query)}`,
    );
    if (!Array.isArray(rows)) throw new Error('Некорректный ответ поиска AniLiberty');
    return rows.filter(
      (r) => r && Number.isSafeInteger(r.id) && r.name && r.type,
    ) as LibertyRelease[];
  }
  async release(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid release');
    const row = await this.request<LibertyRelease>(`/anime/releases/${id}`);
    if (!row || row.id !== id || !Array.isArray(row.episodes))
      throw new Error('Некорректный релиз AniLiberty');
    return row;
  }
  async catalogPage(page: number, limit = 30) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('Invalid catalog bounds');
    const rows = await this.request<unknown>(
      `/anime/catalog/releases?page=${page}&limit=${limit}&f[sorting]=FRESH_AT_DESC`,
    );
    if (!Array.isArray(rows)) throw new Error('Invalid AniLiberty catalog');
    return rows.filter(
      (row): row is LibertyRelease => !!row && Number.isSafeInteger(row.id) && row.name && row.type,
    );
  }
  async catalogPageResult(page: number, limit = 50): Promise<LibertyPage> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('Invalid catalog bounds');
    return parseLibertyPage(
      await this.request(
        `/anime/catalog/releases?page=${page}&limit=${limit}&f[sorting]=FRESH_AT_ASC&include=${encodeURIComponent(libertyIndexFields)}`,
        true,
      ),
      page,
    );
  }
  async releasesList(ids: number[]): Promise<LibertyRelease[]> {
    if (
      !ids.length ||
      ids.length > 50 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw new Error('Invalid release batch');
    const result = parseLibertyPage(
      await this.request(
        `/anime/releases/list?ids=${ids.join(',')}&limit=${ids.length}&page=1&include=${encodeURIComponent(`${libertyIndexFields},${libertyEpisodeFields}`)}`,
        true,
      ),
      1,
    );
    if (
      result.pagination.totalPages !== 1 ||
      result.data.some((row) => !ids.includes(row.id) || !Array.isArray(row.episodes)) ||
      new Set(result.data.map((r) => r.id)).size !== result.data.length
    )
      throw new Error('Invalid or incomplete release batch envelope');
    return result.data;
  }
  async episode(id: string) {
    if (!/^[a-z0-9-]{1,128}$/i.test(id)) throw new Error('Invalid episode ID');
    const row = await this.request<LibertyEpisode>(`/anime/releases/episodes/${id}`);
    if (!row || row.id !== id || !Number.isFinite(row.ordinal) || row.ordinal <= 0)
      throw new Error('Invalid AniLiberty episode');
    return row;
  }
  latest() {
    return this.request<LibertyRelease[]>('/anime/releases/latest?limit=10');
  }
}
export const libertyApi = new AniLibertyApi();
const negatives = new Map<number, number>();
export async function findLibertyRelease(
  id: number,
  target?: MatchMetadata,
): Promise<LibertyRelease | null> {
  if (excludedLibertyIds.has(id)) return null;
  const saved = (mappings as Record<string, Mapping>)[id] || storedMappings()[id];
  if (saved) {
    const row = await libertyApi.release(saved.releaseId);
    if (!releaseMetadataMatches(row, target))
      throw new Error('needs-review: внешний ID противоречит году, сезону или формату.');
    if (
      exactRelease([row], id, target?.malId || saved.malId) ||
      (saved.basis === 'metadata' && target && strictTitleCandidates([row], target).length === 1)
    )
      return row;
    throw new Error('Сохранённое соответствие не подтверждено. Нужна повторная проверка.');
  }
  if (!target || Date.now() - (negatives.get(id) || 0) < 900_000) return null;
  const queries = [
    ...new Set(
      [target.title, target.englishTitle, target.originalTitle].filter(
        (q): q is string => !!q?.trim(),
      ),
    ),
  ].slice(0, 3);
  const candidates = new Map<number, LibertyRelease>();
  for (const query of queries) {
    const rows = await libertyApi.search(query);
    for (const row of rows) candidates.set(row.id, row);
    const matches = [...candidates.values()].filter(
      (r) =>
        Number(r.shikimori?.id) === id ||
        (!r.shikimori?.id && !!target.malId && Number(r.mal?.id) === target.malId),
    );
    if (matches.length > 1) throw new Error('Неоднозначное соответствие. Нужна ручная проверка.');
    const match = exactRelease(matches, id, target.malId);
    if (match) {
      const full = await libertyApi.release(match.id);
      if (!releaseMetadataMatches(full, target))
        throw new Error('needs-review: внешний ID противоречит метаданным.');
      if (!exactRelease([full], id, target.malId))
        throw new Error('Идентификатор релиза не совпадает');
      remember(id, full, full.shikimori?.id ? 'shikimori.id' : 'mal.id');
      return full;
    }
  }
  const fallback = strictTitleCandidates([...candidates.values()], target);
  // Metadata-only candidates are exposed as unresolved, never silently approved.
  if (fallback.length) throw new Error('Возможное соответствие требует ручной проверки.');
  negatives.set(id, Date.now());
  return null;
}
export const aniLibertyProvider: VideoProvider = {
  id: 'aniliberty',
  name: 'AniLiberty',
  regionPolicy: 'provider-response',
  rights: {
    verified: permission.status === 'permission-granted',
    embeddingAllowed: false,
    playbackAllowed: permission.playbackAllowed,
    termsUrl: 'https://aniliberty.top/rules',
    reviewedAt: permission.reviewedAt,
    allowedEmbedOrigins: [],
    allowedPlaybackOrigins: permission.allowedPlaybackOrigins,
  },
  async getSources(animeId): Promise<VideoSource[]> {
    // Browser response is the regional decision. Static builds never contact the API.
    if (typeof window === 'undefined' || !this.rights.verified || !this.rights.playbackAllowed)
      return [];
    const id = /^shikimori:(\d+)$/.exec(animeId)?.[1];
    if (!id) return [];
    const row = await findLibertyRelease(Number(id), metadata.get(animeId));
    if (!row) return [];
    if (row.is_blocked_by_geo !== false) throw new Error('Релиз недоступен в вашем регионе.');
    if (row.is_blocked_by_copyrights !== false)
      throw new Error('Релиз ограничен правообладателем.');
    const sources = (row.episodes || []).flatMap((episode): VideoSource[] => {
      const qualities = [480, 720, 1080].flatMap((height) => {
        const value = episode[`hls_${height}` as keyof LibertyEpisode];
        if (typeof value !== 'string' || !value) return [];
        try {
          const parsed = new URL(value);
          if (
            parsed.protocol !== 'https:' ||
            parsed.username ||
            parsed.password ||
            !this.rights.allowedPlaybackOrigins.includes(parsed.origin)
          )
            return [];
        } catch {
          return [];
        }
        return [{ label: `${height}p`, url: value }];
      });
      if (
        !qualities.length ||
        typeof episode.id !== 'string' ||
        !Number.isFinite(episode.ordinal) ||
        episode.ordinal <= 0
      )
        return [];
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
          availableRegions: [],
          regionChecked: true,
          sourceAttribution: {
            label: 'Озвучка AniLiberty · Открыть источник ↗',
            url: 'https://aniliberty.top/',
          },
        },
      ];
    });
    return [...new Map(sources.map((s) => [s.episodeNumber, s])).values()].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );
  },
};
export const aniLibertyAvailabilityAdapter: AvailabilityAdapter = {
  ...aniLibertyProvider,
  async getUpdates(_cursor) {
    if (typeof window === 'undefined') throw new Error('Browser session required');
    const sources: VideoSource[] = [];
    for (const mapping of libertyMappings)
      sources.push(...(await this.getSources(`shikimori:${mapping.shikimoriId}`)));
    return {
      cursor: new Date().toISOString(),
      sources,
      replaceAnimeIds: libertyMappings.map((m) => `shikimori:${m.shikimoriId}`),
    };
  },
};
