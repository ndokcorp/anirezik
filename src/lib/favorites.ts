import { legacyIds } from './providers/shikimori/legacy';
const KEY = 'anirezik:favorites:v2';
const OLD_KEY = 'anirezik:favorites:v1';
interface FavoriteEntry {
  internalId: string;
  shikimoriId: number;
  slug: string;
}
interface FavoriteStore {
  version: 2;
  entries: FavoriteEntry[];
  unresolvedLegacyIds: string[];
}
const empty = (): FavoriteStore => ({ version: 2, entries: [], unresolvedLegacyIds: [] });
function entry(id: number, slug?: string): FavoriteEntry {
  return {
    internalId: `shikimori:${id}`,
    shikimoriId: id,
    slug: slug || Object.keys(legacyIds).find((k) => legacyIds[k] === id) || `shikimori-${id}`,
  };
}
function stored(): FavoriteStore {
  try {
    const text = localStorage.getItem(KEY);
    if (text) {
      const raw = JSON.parse(text);
      if (raw?.version === 2 && Array.isArray(raw.entries))
        return {
          version: 2,
          entries: raw.entries.filter(
            (e: FavoriteEntry) =>
              e &&
              Number.isSafeInteger(e.shikimoriId) &&
              e.shikimoriId > 0 &&
              e.internalId === `shikimori:${e.shikimoriId}` &&
              typeof e.slug === 'string',
          ),
          unresolvedLegacyIds: Array.isArray(raw.unresolvedLegacyIds)
            ? raw.unresolvedLegacyIds.filter((s: unknown) => typeof s === 'string')
            : [],
        };
      return empty();
    }
    const old: unknown = JSON.parse(localStorage.getItem(OLD_KEY) || '[]');
    if (!Array.isArray(old)) return empty();
    const migrated = empty();
    for (const id of new Set(old.filter((s): s is string => typeof s === 'string'))) {
      if (legacyIds[id]) migrated.entries.push(entry(legacyIds[id], id));
      else migrated.unresolvedLegacyIds.push(id);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(migrated));
    } catch {
      /* Read-only storage still permits displaying migrated favorites. */
    }
    return migrated;
  } catch {
    return empty();
  }
}
export function readFavorites(validIds: string[]): string[] {
  return [
    ...new Set(
      stored()
        .entries.map((e) => e.internalId)
        .filter((id) => validIds.includes(id)),
    ),
  ];
}
export function unavailableFavorites(validIds: string[]): number {
  const state = stored();
  return (
    state.entries.filter((e) => !validIds.includes(e.internalId)).length +
    state.unresolvedLegacyIds.length
  );
}
export function writeFavorites(ids: string[], validIds: string[] = ids): boolean {
  try {
    const previous = stored();
    const preserved = previous.entries.filter((e) => !validIds.includes(e.internalId));
    const next = [...new Set(ids)]
      .map((id) => (/^shikimori:\d+$/.test(id) ? entry(Number(id.split(':')[1])) : null))
      .filter((e): e is FavoriteEntry => !!e);
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        entries: [...preserved, ...next],
        unresolvedLegacyIds: previous.unresolvedLegacyIds,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
export const storedFavoriteIds = () => [...new Set(stored().entries.map(entry => entry.internalId))];
export const unresolvedLegacyCount = () => stored().unresolvedLegacyIds.length;
export { KEY as FAVORITES_KEY, OLD_KEY as LEGACY_FAVORITES_KEY };
