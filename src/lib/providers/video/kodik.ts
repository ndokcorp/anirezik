import mappings from '../../../data/kodik-mappings.json' with { type: 'json' };
import rights from '../../../data/kodik-rights.json' with { type: 'json' };
import type { VideoProvider, VideoSource } from './types';
import { kodikEventSource } from './kodik-events';
import { KodikResolver } from './kodik-resolver';
import config from '../../../data/kodik-catalog-config.json' with { type: 'json' };
import { KodikStaticResolver } from './kodik-catalog-cache';
import { url } from '../../paths';
const resolver = new KodikResolver(mappings, rights.approvedAnimeIds);
const catalogResolver = new KodikStaticResolver(config, async (id) => {
  const response = await fetch(url(`data/video/kodik/${id}.json`));
  if (!response.ok) throw new Error('Kodik cache unavailable');
  return response.json();
});

/** Curated exact-ID iframe releases only. No API tokens, streams or guessed title matches. */
export const kodikProvider: VideoProvider = {
  id: 'kodik',
  name: 'Kodik',
  rights,
  // The untouched provider iframe handles geo/access decisions; no claim of worldwide rights.
  regionPolicy: 'iframe-enforced',
  iframePolicy: {
    allow: "autoplay 'none'; fullscreen; picture-in-picture",
    sandbox: null,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  readStateEvent: kodikEventSource,
  async getSources(animeId) {
    const mapping = resolver.resolve(animeId);
    if (!mapping) return catalogResolver.getSources(animeId);
    const url = new URL(mapping.embedUrl);
    if (url.origin !== 'https://kodikplayer.com' || url.username || url.password) return [];
    return mapping.translations.flatMap((translation) =>
      translation.availableEpisodes.map((episode): VideoSource => {
        const exactEpisodeUrl = translation.episodeUrls?.[String(episode)];
        const embed = new URL(exactEpisodeUrl || translation.embedUrl);
        if (embed.origin !== 'https://kodikplayer.com' || embed.username || embed.password)
          throw new Error('Invalid curated Kodik embed');
        if (!exactEpisodeUrl) embed.searchParams.set('episode', String(episode));
        return {
          animeId,
          episodeNumber: episode,
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
