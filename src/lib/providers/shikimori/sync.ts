import type { Anime, CatalogSnapshot } from '../../../types/anime.ts';
import { ShikimoriApi } from './api.ts';
import { ANIMES_QUERY } from './queries.ts';
import { mapAnime, parseAnimeResponse } from './mapper.ts';
import { legacyIds } from './legacy.ts';
import { readCache, writeCache, atomicJson } from './cache.ts';
export interface SyncOptions {
  output: string;
  cacheDir: string;
  base?: string;
  userAgent?: string;
  maxAgeMs?: number;
  maxTitles?: number;
  ids?: number[];
  previous?: CatalogSnapshot | null;
  editorialDescriptions?: Record<string, string>;
  api?: Pick<ShikimoriApi, 'query'>;
  now?: Date;
}
export async function syncCatalog(options: SyncOptions): Promise<CatalogSnapshot> {
  const base = options.base || 'https://shikimori.io',
    now = options.now || new Date(),
    fetchedAt = now.toISOString();
  const api =
    options.api ||
    new ShikimoriApi({
      base,
      userAgent: options.userAgent || 'AniRezik/0.3.0 (noncommercial metadata catalog)',
    });
  const season = `${['winter', 'spring', 'summer', 'fall'][Math.floor(now.getUTCMonth() / 3)]}_${now.getUTCFullYear()}`;
  const year = now.getUTCFullYear();
  const max = options.maxTitles ?? 3000;
  if (!Number.isSafeInteger(max) || max < 100 || max > 5000)
    throw new Error('Размер каталога должен быть целым числом от 100 до 5000');
  const seedIds = [...new Set([...Object.values(legacyIds), ...(options.ids || [])])];
  const plans: Record<string, unknown>[] = [];
  for (let i = 0; i < seedIds.length; i += 50)
    plans.push({ ids: seedIds.slice(i, i + 50).join(','), limit: 50 });
  const changedIds = (options.previous?.anime || [])
    .filter((item) => ['ongoing', 'anons', 'paused'].includes(item.sourceStatus || ''))
    .map((item) => item.shikimoriId);
  for (let i = 0; i < changedIds.length; i += 50)
    plans.push({ ids: changedIds.slice(i, i + 50).join(','), limit: 50 });
  plans.push({ status: 'ongoing', limit: 50 }, { season, limit: 50 });
  for (let page = 1; page <= Math.ceil(max / 50); page++) plans.push({ page, limit: 50 });
  const mapped = new Map<number, Anime>();
  for (const variables of plans) {
    const key = JSON.stringify({ base, query: ANIMES_QUERY, variables });
    const refreshIds =
      typeof variables.ids === 'string' &&
      variables.ids.split(',').some((id) => changedIds.includes(Number(id)));
    const ttl =
      options.maxAgeMs ??
      (variables.status || variables.season || refreshIds ? 86400000 : 604800000);
    console.log(`Импорт: пакет ${plans.indexOf(variables) + 1}/${plans.length}`);
    const cached = await readCache(options.cacheDir, key, ttl);
    let payload = cached?.data;
    let responseDate = cached ? new Date(cached.savedAt).toISOString() : fetchedAt;
    if (!cached) {
      payload = await api.query(ANIMES_QUERY, variables);
      const rows = parseAnimeResponse(payload);
      if (!rows.length) throw new Error('Пустой ответ API: предыдущий каталог сохранён');
      await writeCache(options.cacheDir, key, payload, now.getTime());
    }
    for (const raw of parseAnimeResponse(payload)) {
      const item = mapAnime(raw, {
        base,
        fetchedAt: responseDate,
        editorialDescriptions: options.editorialDescriptions,
      });
      item.isNew =
        raw.airedOn?.year === year &&
        raw.airedOn.month != null &&
        Math.floor((raw.airedOn.month - 1) / 3) === Math.floor(now.getUTCMonth() / 3);
      const existing = mapped.get(item.shikimoriId);
      if (
        (mapped.size < max || existing) &&
        (!existing || Date.parse(item.fetchedAt) >= Date.parse(existing.fetchedAt))
      )
        mapped.set(item.shikimoriId, item);
    }
  }
  if (mapped.size < 100)
    throw new Error(`Получено только ${mapped.size} записей; каталог не заменён`);
  for (const old of options.previous?.anime || [])
    if (!mapped.has(old.shikimoriId)) mapped.set(old.shikimoriId, old);
  const snapshot: CatalogSnapshot = {
    schemaVersion: 2,
    source: 'shikimori',
    endpoint: base,
    fetchedAt,
    policy: { posters: 'placeholder', descriptions: 'editorial-only', popularity: 'editorial' },
    anime: [...mapped.values()],
  };
  await atomicJson(options.output, snapshot, true);
  return snapshot;
}
