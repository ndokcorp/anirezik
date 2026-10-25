import type { VideoSource } from './types';

/** Observed provider event. Read-only: never inject code or send undocumented commands. */
export function kodikEventSource(
  event: MessageEvent,
  frame: HTMLIFrameElement,
  sources: VideoSource[],
): VideoSource | null {
  if (event.origin !== 'https://kodikplayer.com' || event.source !== frame.contentWindow)
    return null;
  let data: unknown = event.data;
  if (typeof data === 'string') {
    if (data.length > 8192) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (
    message.key !== 'kodik_player_current_episode' ||
    !message.value ||
    typeof message.value !== 'object'
  )
    return null;
  const value = message.value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.episode) ||
    !Number.isSafeInteger(value.season) ||
    !value.translation ||
    typeof value.translation !== 'object'
  )
    return null;
  const id = (value.translation as Record<string, unknown>).id;
  if ((typeof id !== 'number' && typeof id !== 'string') || !/^[1-9]\d{0,12}$/.test(String(id)))
    return null;
  return (
    sources.find(
      (s) =>
        s.providerId === 'kodik' &&
        s.episodeNumber === value.episode &&
        s.seasonNumber === value.season &&
        s.translationId === String(id),
    ) ?? null
  );
}
