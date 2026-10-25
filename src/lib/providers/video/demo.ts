import type { VideoProvider, VideoSource } from './types';
// Separate licensed test material. Never offered as a source for an anime.
export const demoProvider: VideoProvider = {
  id: 'sintel-test',
  name: 'Sintel · тест плеера',
  attributionRequired: true,
  rights: {
    verified: true,
    embeddingAllowed: false,
    playbackAllowed: true,
    termsUrl: 'https://durian.blender.org/sharing/',
    reviewedAt: '2026-10-25',
    allowedEmbedOrigins: [],
    allowedPlaybackOrigins: ['https://media.w3.org'],
  },
  async getSources(animeId) {
    if (animeId !== 'demo:player') return [];
    return [1, 2].map((episodeNumber): VideoSource => ({
      animeId,
      episodeNumber,
      episodeId: `test-${episodeNumber}`,
      releaseId: 'sintel-trailer',
      providerId: 'sintel-test',
      providerName: 'Sintel · тест плеера',
      audioLanguage: 'Оригинальная дорожка',
      dubbingStudio: null,
      subtitles: [],
      playbackUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      availableRegions: ['*'],
      sourceAttribution: {
        label: '© Blender Foundation | durian.blender.org · CC BY 3.0',
        url: 'https://durian.blender.org/sharing/',
      },
    }));
  },
};
