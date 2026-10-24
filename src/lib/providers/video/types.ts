export interface VideoSource {
  animeId: string;
  episodeNumber: number;
  providerId: string;
  providerName: string;
  audioLanguage: string;
  dubbingStudio: string | null;
  subtitles: string[];
  embedUrl?: string;
  playbackUrl?: string;
  availableRegions: string[];
  sourceAttribution: { label: string; url: string };
}
export interface VideoRights {
  verified: boolean;
  embeddingAllowed: boolean;
  playbackAllowed: boolean;
  termsUrl: string;
  reviewedAt: string;
  allowedEmbedOrigins: string[];
  allowedPlaybackOrigins: string[];
}
export interface VideoProvider {
  id: string;
  name: string;
  rights: VideoRights;
  getSources: (animeId: string) => Promise<VideoSource[]>;
}
