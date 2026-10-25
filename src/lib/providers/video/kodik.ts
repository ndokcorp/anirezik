import mappings from '../../../data/kodik-mappings.json' with { type: 'json' };
import rights from '../../../data/kodik-rights.json' with { type: 'json' };
import type { VideoProvider, VideoSource } from './types';
import { kodikEventSource } from './kodik-events';

/** Curated exact-ID iframe releases only. No API tokens, streams or guessed title matches. */
export const kodikProvider: VideoProvider = {
  id: 'kodik',
  name: 'Kodik',
  rights,
  // The untouched provider iframe handles geo/access decisions; no claim of worldwide rights.
  regionPolicy: 'iframe-enforced',
  iframePolicy: {
    allow: 'autoplay; fullscreen; picture-in-picture',
    sandbox: null,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  readStateEvent: kodikEventSource,
  async getSources(animeId) {
    const mapping = (mappings as Record<string, (typeof mappings)['shikimori:39535']>)[animeId];
    if (!mapping) return [];
    const url = new URL(mapping.embedUrl);
    if (url.origin !== 'https://kodikplayer.com' || url.username || url.password) return [];
    return mapping.translations.flatMap((translation) =>
      Array.from({ length: translation.episodes }, (_, index): VideoSource => {
        const embed = new URL(translation.embedUrl);
        if (embed.origin !== 'https://kodikplayer.com' || embed.username || embed.password)
          throw new Error('Invalid curated Kodik embed');
        embed.searchParams.set('episode', String(index + 1));
        return {
          animeId,
          episodeNumber: index + 1,
          providerId: 'kodik',
          providerName: 'Kodik',
          audioLanguage: 'ru',
          dubbingStudio: translation.label,
          subtitles: translation.type === 'subtitles' ? ['ru'] : [],
          translationId: translation.id,
          seasonNumber: mapping.season,
          embedUrl: embed.href,
          releaseId: embed.pathname.split('/')[2],
          availableRegions: [],
          sourceAttribution: { label: 'Kodik', url: 'https://kodikplayer.com/' },
        };
      }),
    );
  },
};
