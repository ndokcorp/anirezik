import type { VideoProvider, VideoSource } from './providers/video/types';
import { isAuthorizedSource } from './providers/video';

export function sameVideoSelection(a: VideoSource, b: VideoSource): boolean {
  return (
    a.animeId === b.animeId &&
    a.providerId === b.providerId &&
    a.releaseId === b.releaseId &&
    a.episodeNumber === b.episodeNumber &&
    a.translationId === b.translationId &&
    a.audioLanguage === b.audioLanguage &&
    a.dubbingStudio === b.dubbingStudio &&
    a.subtitles.join('|') === b.subtitles.join('|')
  );
}

export async function refreshVideoSelection(active: VideoSource, provider: VideoProvider) {
  if (!provider.refreshSources || active.providerId !== provider.id) return null;
  const sources = (await provider.refreshSources(active.animeId)).filter(
    (row) => row.animeId === active.animeId && isAuthorizedSource(row, provider),
  );
  const selected = sources.filter((row) => sameVideoSelection(active, row));
  if (selected.length !== 1) throw Error('Серия или озвучка больше не доступны у источника.');
  return { sources, selected: selected[0] };
}

export function videoFallbacks(
  active: VideoSource,
  sources: VideoSource[],
  providers: readonly VideoProvider[],
) {
  const seen = new Set<string>();
  return sources.filter((row) => {
    const provider = providers.find((p) => p.id === row.providerId);
    if (
      row.animeId !== active.animeId ||
      row.episodeNumber !== active.episodeNumber ||
      row.providerId === active.providerId ||
      seen.has(row.providerId) ||
      !provider ||
      !isAuthorizedSource(row, provider)
    )
      return false;
    seen.add(row.providerId);
    return true;
  });
}
