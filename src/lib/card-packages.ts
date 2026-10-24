import { unpackIndex, type CatalogEntry } from './catalog-index';
import { url } from './paths';
const packages = new Map<number, Promise<CatalogEntry[]>>();
export async function loadFavoriteCards(
  ids: string[],
): Promise<{ entries: CatalogEntry[]; unavailable: number }> {
  const rows = new Map<string, CatalogEntry>();
  const buckets = [
    ...new Set(
      ids
        .filter((id) => /^shikimori:\d+$/.test(id))
        .map((id) => Math.floor(Number(id.split(':')[1]) / 1000)),
    ),
  ];
  // Bound parallel requests on mobile; only buckets for the explicitly requested favorites.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, buckets.length) }, async () => {
      while (next < buckets.length) {
        const bucket = buckets[next++];
        if (!packages.has(bucket))
          packages.set(
            bucket,
            fetch(url(`data/cards/${bucket}.json`), { signal: AbortSignal.timeout(20000) })
              .then(async (response) => {
                if (response.status === 404) return [];
                if (!response.ok) throw new Error('Карточки избранного недоступны');
                return unpackIndex(await response.json(), import.meta.env.BASE_URL);
              })
              .catch((error) => {
                packages.delete(bucket);
                throw error;
              }),
          );
        for (const row of await packages.get(bucket)!) rows.set(row.id, row);
      }
    }),
  );
  const entries = ids.map((id) => rows.get(id)).filter((row): row is CatalogEntry => !!row);
  return { entries, unavailable: ids.length - entries.length };
}
