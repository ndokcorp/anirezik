export interface PlayerProgress {
  animeId: string;
  providerId: string;
  releaseId: string;
  episodeNumber: number;
  audio: string;
  time: number | null;
  duration: number | null;
  updatedAt: string;
}
const key = 'anirezik:playback:v1';
export function readProgress(animeId: string): PlayerProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}')[animeId] as PlayerProgress;
    return value &&
      value.animeId === animeId &&
      typeof value.providerId === 'string' &&
      typeof value.releaseId === 'string' &&
      typeof value.audio === 'string' &&
      Number.isFinite(value.episodeNumber) &&
      value.episodeNumber > 0 &&
      (value.time === null || (Number.isFinite(value.time) && value.time >= 0)) &&
      (value.duration === null || (Number.isFinite(value.duration) && value.duration > 0)) &&
      Number.isFinite(Date.parse(value.updatedAt))
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveProgress(value: PlayerProgress) {
  try {
    let saved: Record<string, PlayerProgress>;
    try {
      saved = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      saved = {};
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    saved[value.animeId] = value;
    localStorage.setItem(
      key,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(saved)
            .sort((a, b) => String(b[1]?.updatedAt).localeCompare(String(a[1]?.updatedAt)))
            .slice(0, 200),
        ),
      ),
    );
  } catch {
    /* Playback remains usable when storage is unavailable. */
  }
}
