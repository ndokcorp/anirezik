const providerKey = 'anirezik:player-provider:v1';
const favouriteKey = 'anirezik:voice-favourites:v1';
export function readPlayerProvider(animeId: string): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(providerKey) || '{}')[animeId];
    return typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
export function savePlayerProvider(animeId: string, providerId: string) {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(providerKey) || '{}');
    const rows =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    delete rows[animeId];
    rows[animeId] = providerId;
    localStorage.setItem(
      providerKey,
      JSON.stringify(Object.fromEntries(Object.entries(rows).slice(-500))),
    );
  } catch {
    /* Storage is optional. */
  }
}
export function readVoiceFavourites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(favouriteKey) || '[]');
    return new Set(
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.length <= 180).slice(0, 200)
        : [],
    );
  } catch {
    return new Set();
  }
}
export function saveVoiceFavourites(value: Set<string>) {
  try {
    localStorage.setItem(favouriteKey, JSON.stringify([...value].slice(-200)));
  } catch {
    /* Optional. */
  }
}
