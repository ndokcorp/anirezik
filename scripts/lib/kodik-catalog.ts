import {
  catalogAccessReady,
  catalogScopeAllows,
  exactKodikEmbed,
  readKodikCatalogEntry,
  type KodikCatalogConfig,
  type KodikCatalogEntry,
  type KodikCachedRelease,
} from '../../src/lib/providers/video/kodik-catalog-cache.ts';

export interface CatalogAnime {
  shikimoriId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  kind: string | null;
  episodes: number | null;
  aliases: string[];
  englishTitle: string | null;
  japaneseTitle: string | null;
}
type Row = Record<string, unknown>;
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('schema');
  return value as Row;
};
const number = (value: unknown): number => {
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error('schema');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > 100000000) throw new Error('schema');
  return n;
};
const titleKey = (value: unknown) =>
  typeof value === 'string'
    ? value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')
    : '';

/** Provisional API profile from the supplied reference. Requires provider confirmation before use. */
export function normalizeKodikSearch(
  input: unknown,
  anime: CatalogAnime,
  config: KodikCatalogConfig,
  now = Date.now(),
): { entry: KodikCatalogEntry; rejected: number } {
  const response = object(input);
  if (
    !Array.isArray(response.results) ||
    !Number.isSafeInteger(response.total) ||
    Number(response.total) < 0 ||
    Number(response.total) < response.results.length ||
    response.error ||
    !anime.year ||
    !anime.kind
  )
    throw new Error('Invalid search envelope/catalog metadata');
  const truncated = !!response.next_page || Number(response.total) > response.results.length;
  const groups = new Map<string, KodikCachedRelease[]>();
  let rejected = 0;
  if (!truncated)
    for (const value of response.results) {
      try {
        const r = object(value),
          material = object(r.material_data),
          translation = object(r.translation);
        const allowedTitles = [
          anime.originalTitle,
          anime.englishTitle,
          anime.japaneseTitle,
          ...anime.aliases,
        ]
          .map(titleKey)
          .filter(Boolean);
        if (
          number(r.shikimori_id) !== anime.shikimoriId ||
          number(r.year) !== anime.year ||
          material.anime_kind !== anime.kind ||
          !allowedTitles.includes(titleKey(r.title_orig)) ||
          !['anime', 'anime-serial'].includes(String(r.type)) ||
          (anime.kind === 'movie' && r.type !== 'anime') ||
          (anime.kind === 'tv' && r.type !== 'anime-serial')
        )
          throw new Error('metadata');
        if (
          !Array.isArray(r.blocked_countries) ||
          r.blocked_countries.some((c) => typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)) ||
          Object.keys(object(r.blocked_seasons ?? {})).length
        )
          throw new Error('region restrictions');
        const translationId = String(number(translation.id));
        if (
          !['voice', 'subtitles'].includes(String(translation.type)) ||
          typeof translation.title !== 'string' ||
          !translation.title.trim() ||
          translation.title.length > 300 ||
          typeof r.id !== 'string' ||
          !(r.type === 'anime-serial' ? /^serial-[1-9]\d*$/ : /^(movie|video)-[1-9]\d*$/).test(r.id)
        )
          throw new Error('translation');
        let season: number | null = null;
        let episodes: KodikCachedRelease['episodes'];
        if (r.type === 'anime') {
          // A one-video container can also represent a one-episode OVA/special.
          // Its anime_kind remains unchanged; never relabel it as a movie.
          if (
            anime.episodes !== 1 ||
            (r.episodes_count !== undefined && r.episodes_count !== null && r.episodes_count !== 1)
          )
            throw new Error('single-video');
          episodes = [{ number: 1, url: exactKodikEmbed(r.link, config.allowedEmbedOrigins) }];
        } else {
          const seasons = Object.entries(object(r.seasons));
          if (seasons.length !== 1) throw new Error('ambiguous provider season');
          season = number(seasons[0][0]);
          episodes = Object.entries(object(object(seasons[0][1]).episodes))
            .map(([n, value]) => ({
              number: number(n),
              url: exactKodikEmbed(
                typeof value === 'string' ? value : object(value).link,
                config.allowedEmbedOrigins,
              ),
            }))
            .sort((a, b) => a.number - b.number);
          if (
            !episodes.length ||
            episodes.length > 10000 ||
            (anime.episodes && episodes.some((e) => e.number > anime.episodes!))
          )
            throw new Error('episodes');
        }
        const release: KodikCachedRelease = {
          releaseId: r.id,
          translationId,
          label: translation.title,
          type: translation.type as 'voice' | 'subtitles',
          season,
          blockedCountries: r.blocked_countries as string[],
          episodes,
        };
        const group = groups.get(translationId) || [];
        // Identical duplicate rows are harmless; different releases for one translation are ambiguous.
        if (!group.some((old) => JSON.stringify(old) === JSON.stringify(release)))
          group.push(release);
        groups.set(translationId, group);
      } catch {
        rejected++;
      }
    }
  const releases = [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group;
    rejected += group.length;
    return [];
  });
  const status = releases.length
    ? 'found'
    : !truncated && response.total === 0
      ? 'not-found'
      : 'needs-review';
  const ttlMs = Math.min(168, Math.max(1, config.ttlHours)) * 3600000;
  const entry: KodikCatalogEntry = {
    schemaVersion: 1,
    shikimoriId: anime.shikimoriId,
    originalTitle: anime.originalTitle,
    year: anime.year,
    kind: anime.kind,
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(
      now + (status === 'not-found' ? Math.min(ttlMs, 3600000) : ttlMs),
    ).toISOString(),
    approvalRevision: config.approvalRevision,
    status,
    releases,
  };
  // Catch repeated media URLs/invalid normalized fields rather than publish an unsafe partial cache.
  if (!readKodikCatalogEntry(entry, anime.shikimoriId, config, now))
    throw new Error('Unsafe normalized search result');
  return { entry, rejected: truncated ? Number(response.total) : rejected };
}

export class KodikApiError extends Error {
  code: string;
  constructor(code: string) {
    super(`Kodik API: ${code}`);
    this.code = code;
  }
}
/** Node/Actions only. Credential-bearing request URLs never enter errors, cache or browser code. */
export class KodikApiClient {
  #token: string;
  private config: KodikCatalogConfig;
  private fetcher: typeof fetch;
  private wait: (ms: number) => Promise<void>;
  private used = 0;
  private lastStarted = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    config: KodikCatalogConfig,
    token: string,
    fetcher = fetch,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    if (
      !catalogAccessReady(config) ||
      !token.trim() ||
      !['https://kodik-api.com', 'https://kodikapi.com'].includes(config.apiOrigin) ||
      !Number.isInteger(config.maxRequestsPerRun) ||
      config.maxRequestsPerRun < 1 ||
      config.maxRequestsPerRun > 5000 ||
      config.minRequestIntervalMs < 1000 ||
      config.minRequestIntervalMs > 60000
    )
      throw new KodikApiError('access-not-configured');
    this.config = config;
    this.#token = token;
    this.fetcher = fetcher;
    this.wait = wait;
  }
  lookupByShikimoriId(id: number): Promise<unknown> {
    const task = this.tail.then(() => this.request(id));
    this.tail = task.catch(() => {});
    return task;
  }
  private async request(id: number): Promise<unknown> {
    if (!catalogScopeAllows(this.config, id)) throw new KodikApiError('outside-approved-scope');
    if (this.used >= this.config.maxRequestsPerRun) throw new KodikApiError('request-budget');
    await this.wait(Math.max(0, this.lastStarted + this.config.minRequestIntervalMs - Date.now()));
    this.lastStarted = Date.now();
    this.used++;
    // Match the reference SDK's POST + query encoding. Never log/persist this server-only URL.
    const query = new URLSearchParams({
      token: this.#token,
      shikimori_id: String(id),
      limit: '100',
      with_episodes: 'true',
      with_seasons: 'true',
      with_material_data: 'true',
    });
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.apiOrigin}/search?${query}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AniRezik/0.4.7 (approved catalog cache)',
        },
      });
    } catch {
      throw new KodikApiError('transport');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 429)
        this.used = this.config.maxRequestsPerRun; // Stop the queue; no authentication/rate-limit retries.
      throw new KodikApiError(`http-${response.status}`);
    }
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new KodikApiError('invalid-response');
    }
  }
}
export function safeKodikCacheJSON(entry: KodikCatalogEntry, token: string) {
  const value = JSON.stringify(entry);
  if (!token || value.includes(token)) throw new KodikApiError('unsafe-cache');
  return value;
}
