import type { VideoProvider, VideoSource } from './types';
import { isAuthorizedSource } from './index';

/** Separate provider cursor, never derived from Shikimori episodesAired. No adapter is enabled. */
export interface AvailabilityAdapter extends VideoProvider {
  getUpdates(cursor: string | null): Promise<{ cursor: string; sources: VideoSource[] }>;
}
export interface AvailabilitySnapshot {
  providerId: string;
  cursor: string | null;
  sources: VideoSource[];
  checkedAt: string | null;
}
const key = (a: VideoSource) =>
  JSON.stringify([a.animeId, a.episodeNumber, a.audioLanguage, a.dubbingStudio]);
export async function refreshAvailability(
  adapter: AvailabilityAdapter,
  previous: AvailabilitySnapshot,
  region: string,
): Promise<AvailabilitySnapshot> {
  if (!adapter.rights.verified || previous.providerId !== adapter.id)
    throw new Error('Provider is not approved');
  const batch = await adapter.getUpdates(previous.cursor);
  if (
    !batch.cursor ||
    !Array.isArray(batch.sources) ||
    batch.sources.some(
      (a) => !/^shikimori:\d+$/.test(a.animeId) || !isAuthorizedSource(a, adapter, region),
    )
  )
    throw new Error('Invalid provider availability update');
  const sources = new Map(previous.sources.map((a) => [key(a), a]));
  for (const source of batch.sources) sources.set(key(source), source);
  // New object only after successful validation; caller may atomically persist it separately.
  return {
    providerId: adapter.id,
    cursor: batch.cursor,
    sources: [...sources.values()],
    checkedAt: new Date().toISOString(),
  };
}
