export interface KodikTranslation {
  id: string;
  label: string;
  type: 'voice' | 'subtitles';
  embedUrl: string;
  episodes: number;
  availableEpisodes: number[];
  episodeUrls?: Record<string, string>;
  shikimoriId: number;
  season: number;
  part: number;
  year: number | null;
  format: string;
}
export interface KodikMapping {
  shikimoriId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  format: string;
  season: number;
  part: number;
  episodes: number;
  embedUrl: string;
  confirmedAt: string;
  permissionEvidence: string;
  episodeQueryVerified: boolean;
  translations: KodikTranslation[];
}
export interface KodikCatalogLookup {
  /** Future approved metadata service; private keys belong on its server, never in this client. */
  lookupByShikimoriId(id: number): Promise<unknown>;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected mapping object');
  return value as Record<string, unknown>;
};
const integer = (value: unknown, maximum = 10000): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error('Invalid positive number');
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    throw new Error('Missing mapping evidence/metadata');
  return value;
};
function embedUrl(value: unknown): string {
  const url = new URL(text(value));
  if (
    url.origin !== 'https://kodikplayer.com' ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/(serial|seria|video)\/[1-9]\d*\/[a-f0-9]{30,64}\/(720p|1080p|480p)$/.test(url.pathname) ||
    [...url.searchParams].some(([key, val]) => key !== 'episode' || !/^[1-9]\d*$/.test(val))
  )
    throw new Error('Invalid official embed URL');
  return url.href;
}
export function parseKodikMapping(animeId: string, input: unknown): KodikMapping {
  const raw = object(input);
  if (
    !/^shikimori:[1-9]\d*$/.test(animeId) ||
    raw.status !== 'confirmed' ||
    raw.shikimoriId !== Number(animeId.split(':')[1])
  )
    throw new Error('Unconfirmed or mismatched Shikimori ID');
  const year = raw.year === null ? null : integer(raw.year, 2200);
  if (year !== null && year < 1900) throw new Error('Invalid release year');
  const mapping: KodikMapping = {
    shikimoriId: integer(raw.shikimoriId, 99999999),
    title: text(raw.title),
    originalTitle: text(raw.originalTitle),
    year,
    format: text(raw.format),
    season: integer(raw.season, 100),
    part: integer(raw.part, 100),
    episodes: integer(raw.episodes),
    embedUrl: embedUrl(raw.embedUrl),
    confirmedAt: text(raw.confirmedAt),
    permissionEvidence: text(raw.permissionEvidence),
    episodeQueryVerified: raw.episodeQueryVerified === true,
    translations: [],
  };
  if (
    !Number.isFinite(Date.parse(mapping.confirmedAt)) ||
    !/^docs\/rights\/[a-zA-Z0-9_-]+\.md$/.test(mapping.permissionEvidence)
  )
    throw new Error('Missing permission/date evidence');
  if (mapping.episodeQueryVerified) text(raw.episodeNavigationEvidence);
  if (!Array.isArray(raw.translations) || !raw.translations.length || raw.translations.length > 200)
    throw new Error('Invalid translation list');
  const ids = new Set<string>();
  const media = new Set<string>();
  for (const entry of raw.translations) {
    const row = object(entry),
      id = text(row.id),
      count = integer(row.episodes);
    if (!/^[1-9]\d*$/.test(id) || ids.has(id) || !['voice', 'subtitles'].includes(String(row.type)))
      throw new Error('Duplicate/invalid translation ID');
    if (
      row.shikimoriId !== mapping.shikimoriId ||
      row.season !== mapping.season ||
      row.part !== mapping.part ||
      row.year !== mapping.year ||
      row.format !== mapping.format
    )
      throw new Error('Translation belongs to another season/year/format');
    const episodes =
      row.availableEpisodes === undefined
        ? Array.from({ length: count }, (_, i) => i + 1)
        : row.availableEpisodes;
    if (
      !Array.isArray(episodes) ||
      episodes.length !== count ||
      count > mapping.episodes ||
      new Set(episodes).size !== count ||
      episodes.some((n) => integer(n) > mapping.episodes)
    )
      throw new Error('Invalid available episodes');
    const episodeUrls =
      row.episodeUrls === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(object(row.episodeUrls)).map(([n, url]) => [n, embedUrl(url)]),
          );
    if (!mapping.episodeQueryVerified && episodes.some((n) => !episodeUrls?.[String(n)]))
      throw new Error('Exact episode URLs required without verified navigation contract');
    const translationUrl = embedUrl(row.embedUrl);
    const mediaKey = new URL(translationUrl).pathname;
    if (media.has(mediaKey)) throw new Error('Different translation IDs use the same media link');
    media.add(mediaKey);
    mapping.translations.push({
      id,
      label: text(row.label),
      type: row.type as 'voice' | 'subtitles',
      embedUrl: translationUrl,
      episodes: count,
      availableEpisodes: episodes,
      episodeUrls,
      shikimoriId: mapping.shikimoriId,
      season: mapping.season,
      part: mapping.part,
      year: mapping.year,
      format: mapping.format,
    });
    ids.add(id);
  }
  return mapping;
}
export function validateKodikCatalogMetadata(
  mapping: KodikMapping,
  anime:
    | {
        title: string;
        originalTitle: string;
        year: number | null;
        type: string;
        episodes: number | null;
      }
    | undefined,
) {
  if (
    !anime ||
    anime.title !== mapping.title ||
    anime.originalTitle !== mapping.originalTitle ||
    anime.year !== mapping.year ||
    anime.type !== mapping.format ||
    (anime.episodes !== null && mapping.episodes > anime.episodes)
  )
    throw new Error('Metadata differs from checked-in catalog');
}
export class KodikResolver {
  private cache = new Map<string, KodikMapping | null>();
  private rows: Record<string, unknown>;
  private approvedIds: readonly number[];
  constructor(rows: Record<string, unknown>, approvedIds: readonly number[]) {
    this.rows = rows;
    this.approvedIds = approvedIds;
  }
  resolve(animeId: string): KodikMapping | null {
    if (this.cache.has(animeId)) return this.cache.get(animeId)!;
    let result: KodikMapping | null = null;
    if (
      this.approvedIds.includes(Number(animeId.split(':')[1])) &&
      Object.hasOwn(this.rows, animeId)
    ) {
      try {
        result = parseKodikMapping(animeId, this.rows[animeId]);
      } catch {
        /* Fail closed; CLI reports errors. */
      }
    }
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(animeId, result);
    return result;
  }
}
