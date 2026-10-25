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
const providerKey = 'anirezik:playback-providers:v1';
function validProgress(
  value: unknown,
  animeId: string,
  providerId?: string,
): value is PlayerProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as PlayerProgress;
  return (
    row.animeId === animeId &&
    (!providerId || row.providerId === providerId) &&
    typeof row.providerId === 'string' &&
    typeof row.releaseId === 'string' &&
    typeof row.audio === 'string' &&
    Number.isFinite(row.episodeNumber) &&
    row.episodeNumber > 0 &&
    (row.time === null || (Number.isFinite(row.time) && row.time >= 0)) &&
    (row.duration === null || (Number.isFinite(row.duration) && row.duration > 0)) &&
    Number.isFinite(Date.parse(row.updatedAt))
  );
}
export function readProgress(animeId: string, providerId?: string): PlayerProgress | null {
  try {
    let providerValue = null;
    try {
      providerValue = providerId
        ? JSON.parse(localStorage.getItem(providerKey) || '{}')[`${animeId}|${providerId}`]
        : null;
    } catch {
      /* Keep legacy progress usable. */
    }
    if (validProgress(providerValue, animeId, providerId)) return providerValue;
    const legacy: unknown = JSON.parse(localStorage.getItem(key) || '{}')[animeId];
    return validProgress(legacy, animeId, providerId) ? legacy : null;
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
    const previousLegacy = saved[value.animeId];
    saved[value.animeId] = value;
    // Retain the legacy key and a separate per-provider position: iframe selection must not erase HLS progress.
    let previous: unknown;
    try {
      previous = JSON.parse(localStorage.getItem(providerKey) || '{}');
    } catch {
      previous = {};
    }
    const positions =
      previous && typeof previous === 'object' && !Array.isArray(previous)
        ? (previous as Record<string, PlayerProgress>)
        : {};
    if (validProgress(previousLegacy, value.animeId)) {
      const previousKey = `${value.animeId}|${previousLegacy.providerId}`;
      if (!positions[previousKey]) positions[previousKey] = previousLegacy;
    }
    positions[`${value.animeId}|${value.providerId}`] = value;
    localStorage.setItem(
      providerKey,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(positions)
            .sort((a, b) => String(b[1]?.updatedAt).localeCompare(String(a[1]?.updatedAt)))
            .slice(0, 400),
        ),
      ),
    );
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
