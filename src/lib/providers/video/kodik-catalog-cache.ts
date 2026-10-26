import type { VideoSource } from './types';

export interface KodikCatalogConfig {
  enabled: boolean;
  apiOrigin: string;
  apiAccessApproved: boolean;
  contractConfirmed: boolean;
  rateLimitsConfirmed: boolean;
  cachePublicationApproved: boolean;
  embeddingApproved: boolean;
  playbackSampleVerified: boolean;
  permissionEvidence: string | null;
  approvalRevision: string;
  reviewedAt: string | null;
  scope: string;
  approvedAnimeIds: number[];
  allowedEmbedOrigins: string[];
  ttlHours: number;
  minRequestIntervalMs: number;
  maxRequestsPerRun: number;
  maxRequestsPerDay: number;
  probeIds: number[];
}
export interface KodikCachedRelease {
  releaseId: string;
  translationId: string;
  label: string;
  type: 'voice' | 'subtitles';
  season: number | null;
  blockedCountries: string[];
  episodes: { number: number; url: string }[];
}
export interface KodikCatalogEntry {
  schemaVersion: 1;
  shikimoriId: number;
  originalTitle: string;
  year: number;
  kind: string;
  fetchedAt: string;
  expiresAt: string;
  approvalRevision: string;
  status: 'found' | 'not-found' | 'needs-review';
  releases: KodikCachedRelease[];
}
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const shortText = (n: unknown): n is string =>
  typeof n === 'string' && !!n.trim() && n.length <= 300;
export function catalogScopeAllows(config: KodikCatalogConfig, id: number) {
  return positive(id) && (config.scope === 'catalog' || config.approvedAnimeIds.includes(id));
}
export function catalogAccessReady(config: KodikCatalogConfig) {
  return (
    config.apiAccessApproved &&
    config.contractConfirmed &&
    config.rateLimitsConfirmed &&
    /^docs\/rights\/[A-Z0-9_-]+\.md$/i.test(config.permissionEvidence || '') &&
    shortText(config.approvalRevision) &&
    config.approvalRevision !== 'unapproved' &&
    Number.isFinite(Date.parse(config.reviewedAt || '')) &&
    Date.parse(config.reviewedAt!) <= Date.now() + 60000 &&
    ['selected', 'catalog'].includes(config.scope) &&
    config.approvedAnimeIds.every(positive) &&
    Number.isInteger(config.ttlHours) &&
    config.ttlHours >= 1 &&
    config.ttlHours <= 168 &&
    Number.isInteger(config.minRequestIntervalMs) &&
    config.minRequestIntervalMs >= 1000 &&
    config.minRequestIntervalMs <= 60000 &&
    Number.isInteger(config.maxRequestsPerRun) &&
    config.maxRequestsPerRun >= 1 &&
    config.maxRequestsPerRun <= 5000 &&
    Number.isInteger(config.maxRequestsPerDay) &&
    config.maxRequestsPerDay >= config.maxRequestsPerRun
  );
}
export function catalogPlaybackReady(config: KodikCatalogConfig) {
  return (
    config.enabled &&
    catalogAccessReady(config) &&
    config.cachePublicationApproved &&
    config.embeddingApproved &&
    config.playbackSampleVerified
  );
}
/** Accept only provider-returned iframe URLs. No domain replacement or generated hashes/query. */
export function exactKodikEmbed(input: unknown, origins: readonly string[]): string {
  if (typeof input !== 'string') throw new Error('Invalid embed');
  const parsed = new URL(input.startsWith('//') ? `https:${input}` : input);
  if (
    parsed.protocol !== 'https:' ||
    !origins.includes(parsed.origin) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/(?:serial|season|seria|video)\/[1-9]\d*\/[a-f0-9]{30,64}\/(?:720p|1080p|480p)$/.test(
      parsed.pathname,
    )
  )
    throw new Error('Unapproved embed');
  return parsed.href;
}
/** Reconstruct a small allowlisted object, not arbitrary API JSON. Invalid/stale data fail closed. */
export function readKodikCatalogEntry(
  input: unknown,
  id: number,
  config: KodikCatalogConfig,
  now = Date.now(),
): KodikCatalogEntry | null {
  try {
    if (!input || typeof input !== 'object') return null;
    const row = input as KodikCatalogEntry;
    const fetched = Date.parse(row.fetchedAt),
      expires = Date.parse(row.expiresAt);
    const ttl = Math.min(168, Math.max(1, config.ttlHours)) * 3600000;
    if (
      row.schemaVersion !== 1 ||
      row.shikimoriId !== id ||
      !positive(id) ||
      row.approvalRevision !== config.approvalRevision ||
      !shortText(row.originalTitle) ||
      !positive(row.year) ||
      row.year < 1900 ||
      row.year > 2200 ||
      !['tv', 'movie', 'ova', 'ona', 'special', 'tv_special', 'music'].includes(row.kind) ||
      !Number.isFinite(fetched) ||
      !Number.isFinite(expires) ||
      fetched > now + 60000 ||
      expires <= now ||
      expires <= fetched ||
      expires - fetched > ttl ||
      !['found', 'not-found', 'needs-review'].includes(row.status) ||
      !Array.isArray(row.releases) ||
      row.releases.length > 200 ||
      (row.status === 'found') !== row.releases.length > 0
    )
      return null;
    const ids = new Set<string>();
    const media = new Set<string>();
    const releases = row.releases.map((r): KodikCachedRelease => {
      if (
        !/^[1-9]\d{0,12}$/.test(r.translationId) ||
        !shortText(r.label) ||
        !/^(?:serial|movie|video)-[1-9]\d*$/.test(r.releaseId) ||
        ids.has(r.translationId) ||
        !['voice', 'subtitles'].includes(r.type) ||
        (row.kind === 'movie' && r.season !== null) ||
        (r.season !== null && !positive(r.season)) ||
        (r.season === null && row.kind === 'tv') ||
        (r.season === null) !== /^(?:movie|video)-/.test(r.releaseId) ||
        !Array.isArray(r.blockedCountries) ||
        r.blockedCountries.some((c) => !/^[A-Z]{2}$/.test(c)) ||
        !Array.isArray(r.episodes) ||
        !r.episodes.length ||
        r.episodes.length > 10000
      )
        throw new Error('Invalid cached release');
      const numbers = new Set<number>();
      const episodes = r.episodes.map((e) => {
        const url = exactKodikEmbed(e.url, config.allowedEmbedOrigins);
        if (!positive(e.number) || numbers.has(e.number) || media.has(url))
          throw new Error('Duplicate episode');
        numbers.add(e.number);
        media.add(url);
        return { number: e.number, url };
      });
      if (r.season === null && (episodes.length !== 1 || episodes[0].number !== 1))
        throw new Error('Invalid single-video episode list');
      ids.add(r.translationId);
      return {
        releaseId: r.releaseId,
        translationId: r.translationId,
        label: r.label,
        type: r.type,
        season: r.season,
        blockedCountries: [...r.blockedCountries],
        episodes,
      };
    });
    return {
      schemaVersion: 1,
      shikimoriId: id,
      originalTitle: row.originalTitle,
      year: row.year,
      kind: row.kind,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      approvalRevision: row.approvalRevision,
      status: row.status,
      releases,
    };
  } catch {
    return null;
  }
}
export function cachedKodikSources(entry: KodikCatalogEntry, region?: string): VideoSource[] {
  return entry.releases
    .filter((r) => !region || !r.blockedCountries.includes(region.toUpperCase()))
    .flatMap((r) =>
      r.episodes.map((e) => ({
        animeId: `shikimori:${entry.shikimoriId}`,
        episodeNumber: e.number,
        providerId: 'kodik',
        providerName: 'Kodik',
        audioLanguage: 'ru',
        dubbingStudio: r.label,
        subtitles: r.type === 'subtitles' ? ['ru'] : [],
        translationId: r.translationId,
        seasonNumber: r.season ?? undefined,
        releaseId: r.releaseId,
        embedUrl: e.url,
        availableRegions: [],
        blockedRegions: [...r.blockedCountries],
        sourceAttribution: { label: 'Kodik', url: 'https://kodikplayer.com/' },
      })),
    );
}
/** One static per-ID file on detail pages; no token, API call, or whole-catalog client payload. */
export class KodikStaticResolver {
  private entries = new Map<number, { expires: number; result: Promise<VideoSource[]> }>();
  private config: KodikCatalogConfig;
  private load: (id: number) => Promise<unknown>;
  private now: () => number;
  constructor(config: KodikCatalogConfig, load: (id: number) => Promise<unknown>, now = Date.now) {
    this.config = config;
    this.load = load;
    this.now = now;
  }
  async getSources(animeId: string): Promise<VideoSource[]> {
    if (!/^shikimori:[1-9]\d*$/.test(animeId) || !catalogPlaybackReady(this.config)) return [];
    const id = Number(animeId.split(':')[1]);
    if (!catalogScopeAllows(this.config, id)) return [];
    const old = this.entries.get(id);
    if (old && old.expires > this.now()) return old.result;
    const record = { expires: this.now() + 60000, result: Promise.resolve([] as VideoSource[]) };
    record.result = this.load(id)
      .then((raw) => {
        const entry = readKodikCatalogEntry(raw, id, this.config, this.now());
        if (!entry) return [];
        record.expires = Date.parse(entry.expiresAt);
        return cachedKodikSources(entry);
      })
      .catch(() => []);
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(id, record);
    return record.result;
  }
}
