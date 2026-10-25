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
  releaseId?: string;
  episodeId?: string;
  translationId?: string;
  seasonNumber?: number;
  qualities?: { label: string; url: string }[];
  availableRegions: string[];
  sourceAttribution: { label: string; url: string };
  regionChecked?: boolean;
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
  regionPolicy?: 'provider-response' | 'iframe-enforced';
  iframePolicy?: {
    allow: string;
    sandbox: string | null;
    referrerPolicy: ReferrerPolicy;
  };
  readStateEvent?: (
    event: MessageEvent,
    frame: HTMLIFrameElement,
    sources: VideoSource[],
  ) => VideoSource | null;
  attributionRequired?: boolean;
}
