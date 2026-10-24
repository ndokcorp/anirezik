export const collectionLabels = {
  watching: 'Смотрю',
  completed: 'Просмотрено',
  planned: 'В планах',
  rewatching: 'Пересматриваю',
} as const;
export type CollectionStatus = keyof typeof collectionLabels;
export const COLLECTION_KEY = 'anirezik:collection:v1',
  HISTORY_KEY = 'anirezik:history:v1';
const validId = (id: unknown): id is string => typeof id === 'string' && /^shikimori:\d+$/.test(id);
export function collection(): Record<string, CollectionStatus> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLECTION_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, status]) =>
          validId(id) && typeof status === 'string' && Object.hasOwn(collectionLabels, status),
      ),
    );
  } catch {
    return {};
  }
}
export function setCollection(id: string, status: CollectionStatus): boolean {
  if (!validId(id) || !Object.hasOwn(collectionLabels, status)) return false;
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify({ ...collection(), [id]: status }));
    document.dispatchEvent(new Event('anirezik:library-change'));
    return true;
  } catch {
    return false;
  }
}
export function historyIds(): string[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    const data: unknown =
      stored === null
        ? JSON.parse(localStorage.getItem('anirezik:recent:v1') || '[]').map(
            (item: { id?: unknown }) => item?.id,
          )
        : JSON.parse(stored);
    return Array.isArray(data) ? [...new Set(data.filter(validId))].slice(0, 200) : [];
  } catch {
    return [];
  }
}
export function recordHistory(id: string) {
  if (!validId(id)) return;
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([id, ...historyIds().filter((value) => value !== id)].slice(0, 200)),
    );
  } catch {
    /* Browser storage unavailable. */
  }
}
