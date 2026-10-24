import type { Anime } from '../../../types/anime.ts';
import type { ShikimoriAnime, IncompleteDate } from './types.ts';
import { legacyIds, editorialIds } from './legacy.ts';
export const PLACEHOLDER = '/assets/poster-placeholder.svg';
const kinds: Record<string, string> = {
  tv: 'TV',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спецвыпуск',
  tv_special: 'ТВ-спецвыпуск',
  music: 'Клип',
  pv: 'Проморолик',
  cm: 'Реклама',
};
const statuses: Record<string, string> = {
  released: 'Завершён',
  ongoing: 'Выходит',
  anons: 'Анонс',
  paused: 'Приостановлен',
  discontinued: 'Прекращён',
};
const text = (v: unknown): v is string => typeof v === 'string';
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const nullableText = (v: unknown) => v == null || text(v);
const validDate = (v: unknown) =>
  v == null ||
  (record(v) &&
    ['year', 'month', 'day'].every((k) => v[k] == null || Number.isInteger(v[k])) &&
    nullableText(v.date) &&
    (v.year == null || (Number(v.year) >= 1 && Number(v.year) <= 9999)) &&
    (v.month == null || (Number(v.month) >= 1 && Number(v.month) <= 12)) &&
    (v.day == null || (Number(v.day) >= 1 && Number(v.day) <= 31)));
const numberOrNull = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v));
export function validateApiAnime(value: unknown): asserts value is ShikimoriAnime {
  if (
    !record(value) ||
    !/^\d+$/.test(String(value.id)) ||
    !Number.isSafeInteger(Number(value.id)) ||
    Number(value.id) < 1 ||
    !text(value.name) ||
    !value.name.trim() ||
    !text(value.url) ||
    !['russian', 'english', 'japanese', 'kind', 'status', 'rating', 'nextEpisodeAt'].every((k) =>
      nullableText(value[k]),
    ) ||
    !['score', 'duration'].every((k) => numberOrNull(value[k])) ||
    !['episodes', 'episodesAired'].every(
      (k) => Number.isInteger(value[k]) && Number(value[k]) >= 0,
    ) ||
    !validDate(value.airedOn) ||
    !validDate(value.releasedOn) ||
    !Array.isArray(value.synonyms) ||
    !value.synonyms.every(text) ||
    !Array.isArray(value.studios) ||
    !value.studios.every((s) => record(s) && text(s.name) && /^\d+$/.test(String(s.id))) ||
    !Array.isArray(value.genres) ||
    !value.genres.every(
      (g) => record(g) && text(g.name) && nullableText(g.russian) && text(g.kind),
    ) ||
    (value.poster != null &&
      (!record(value.poster) ||
        !text(value.poster.originalUrl) ||
        !nullableText(value.poster.mainUrl))) ||
    !Array.isArray(value.related) ||
    !value.related.every(
      (r) =>
        record(r) &&
        text(r.relationKind) &&
        text(r.relationText) &&
        (r.anime == null ||
          (record(r.anime) &&
            /^\d+$/.test(String(r.anime.id)) &&
            text(r.anime.name) &&
            nullableText(r.anime.russian) &&
            text(r.anime.url))),
    )
  )
    throw new Error('Некорректная структура Anime в ответе Shikimori');
}
export function safeSourceUrl(value: string, base: string): string {
  const parsed = new URL(value, base);
  const origin = new URL(base);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== origin.hostname ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Недопустимая ссылка Shikimori');
  return parsed.href;
}
function date(value: IncompleteDate | null): string | null {
  if (!value?.year) return null;
  return `${value.year}${value.month ? '-' + String(value.month).padStart(2, '0') : ''}${value.month && value.day ? '-' + String(value.day).padStart(2, '0') : ''}`;
}
export function mapAnime(
  raw: unknown,
  options: { base: string; fetchedAt: string; editorialDescriptions?: Record<string, string> },
): Anime {
  validateApiAnime(raw);
  const id = Number(raw.id);
  const legacy = Object.keys(legacyIds).filter((k) => legacyIds[k] === id);
  const genres = raw.genres.filter((g) => g.kind === 'genre').map((g) => g.russian || g.name);
  const themes = raw.genres.filter((g) => g.kind !== 'genre').map((g) => g.russian || g.name);
  const description = options.editorialDescriptions?.[String(id)] || '';
  return {
    id: `shikimori:${id}`,
    internalId: `shikimori:${id}`,
    shikimoriId: id,
    slug: legacy[0] || `shikimori-${id}`,
    legacyIds: legacy,
    title: raw.russian || raw.name,
    originalTitle: raw.name,
    englishTitle: raw.english ?? null,
    japaneseTitle: raw.japanese ?? null,
    aliases: [
      ...new Set(
        [raw.english, raw.japanese, ...raw.synonyms].filter((s): s is string => !!s?.trim()),
      ),
    ],
    description,
    descriptionSource: description ? 'editorial' : null,
    genres: [...new Set(genres)],
    themes: [...new Set(themes)],
    studios: [...new Set(raw.studios.map((s) => s.name))],
    year: raw.airedOn?.year || null,
    type: kinds[raw.kind || ''] || '—',
    kind: raw.kind ?? null,
    status: statuses[raw.status || ''] || '—',
    sourceStatus: raw.status ?? null,
    ageRating: raw.rating
      ? { g: 'G', pg: 'PG', pg_13: 'PG-13', r: 'R-17', r_plus: 'R+', rx: 'Rx' }[raw.rating] ||
        raw.rating.toUpperCase().replaceAll('_', '-')
      : null,
    score: raw.score && raw.score > 0 && raw.score <= 10 ? raw.score : null,
    episodes: raw.episodes > 0 ? raw.episodes : null,
    episodesAired: raw.episodesAired,
    duration: raw.duration && raw.duration > 0 ? raw.duration : null,
    airedOn: date(raw.airedOn),
    releasedOn: date(raw.releasedOn),
    nextEpisodeAt:
      raw.nextEpisodeAt && Number.isFinite(Date.parse(raw.nextEpisodeAt))
        ? raw.nextEpisodeAt
        : null,
    poster: PLACEHOLDER,
    banner: PLACEHOLDER,
    sourcePosterUrl: raw.poster?.originalUrl?.startsWith('https://')
      ? raw.poster.originalUrl
      : null,
    posterAttribution: null,
    sourcePosterMainUrl: raw.poster?.mainUrl?.startsWith('https://') ? raw.poster.mainUrl : null,
    popular: editorialIds.includes(id),
    isNew: false,
    related: raw.related
      .filter((r) => r.anime)
      .map((r) => ({
        shikimoriId: Number(r.anime!.id),
        title: r.anime!.russian || r.anime!.name,
        relation: r.relationText,
        relationKind: r.relationKind,
        sourceUrl: safeSourceUrl(r.anime!.url, options.base),
      })),
    sourceUrl: safeSourceUrl(raw.url, options.base),
    fetchedAt: options.fetchedAt,
    sources: [],
  };
}
export function parseAnimeResponse(value: unknown): ShikimoriAnime[] {
  if (!record(value) || value.errors)
    throw new Error(
      `Ошибка GraphQL: ${record(value) ? JSON.stringify(value.errors).slice(0, 600) : 'не объект'}`,
    );
  if (!record(value.data) || !Array.isArray(value.data.animes))
    throw new Error('Отсутствует data.animes');
  value.data.animes.forEach(validateApiAnime);
  return value.data.animes as ShikimoriAnime[];
}
