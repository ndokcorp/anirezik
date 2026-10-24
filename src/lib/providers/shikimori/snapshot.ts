import type { CatalogSnapshot } from '../../../types/anime.ts';

/** Fail closed before either manual or automated snapshot publication. */
export function assertCatalogUpdate(previous: CatalogSnapshot, next: CatalogSnapshot) {
  if (
    next.schemaVersion !== 2 ||
    next.source !== 'shikimori' ||
    JSON.stringify(next.policy) !== JSON.stringify(previous.policy)
  )
    throw new Error('Snapshot policy/schema changed');
  const byId = new Map(next.anime.map((a) => [a.shikimoriId, a]));
  if (byId.size !== next.anime.length) throw new Error('Duplicate snapshot IDs');
  for (const a of next.anime) {
    if (
      !Number.isSafeInteger(a.shikimoriId) ||
      a.shikimoriId < 1 ||
      a.id !== `shikimori:${a.shikimoriId}` ||
      a.internalId !== a.id ||
      !a.title ||
      !a.originalTitle ||
      !Array.isArray(a.aliases) ||
      !Array.isArray(a.related) ||
      !Array.isArray(a.studios) ||
      !Array.isArray(a.genres) ||
      !Number.isFinite(Date.parse(a.fetchedAt))
    )
      throw new Error('Invalid snapshot record');
    if (a.description && a.descriptionSource !== 'editorial')
      throw new Error('Unapproved description');
    if (a.imageLicenseStatus === 'local-experiment' || a.imageSource === 'Shikimori')
      throw new Error('Snapshot must not activate poster rights');
  }
  for (const old of previous.anime) {
    const a = byId.get(old.shikimoriId);
    if (!a) throw new Error(`Snapshot lost ID ${old.shikimoriId}`);
    if (
      a.slug !== old.slug ||
      a.internalId !== old.internalId ||
      JSON.stringify(a.legacyIds) !== JSON.stringify(old.legacyIds)
    )
      throw new Error('Snapshot changed stable identity');
    if (old.description && !a.description) throw new Error('Snapshot lost description');
  }
  if (next.anime.length > previous.anime.length + Math.max(500, previous.anime.length * 0.1))
    throw new Error('Unexpected growth: review snapshot manually');
}
