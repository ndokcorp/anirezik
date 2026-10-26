import type { VideoProvider, VideoSource } from './types';
import { aniLibertyProvider } from './aniliberty';
import { kodikProvider } from './kodik';
// No provider is implicitly approved by an API result, a studio name, or a URL.
export const approvedProviders: ReadonlyArray<VideoProvider> = [kodikProvider, aniLibertyProvider];
function allowedUrl(value: string | undefined, origins: string[]): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      origins.includes(parsed.origin)
    );
  } catch {
    return false;
  }
}
export function isAuthorizedSource(
  source: VideoSource,
  provider: VideoProvider,
  region?: string,
): boolean {
  const rights = provider.rights;
  let termsOrigin: string;
  let attributionOrigin: string;
  try {
    termsOrigin = new URL(rights.termsUrl).origin;
    attributionOrigin = new URL(source.sourceAttribution.url).origin;
  } catch {
    return false;
  }
  return (
    rights.verified &&
    Number.isFinite(Date.parse(rights.reviewedAt)) &&
    allowedUrl(rights.termsUrl, [termsOrigin]) &&
    allowedUrl(source.sourceAttribution.url, [attributionOrigin]) &&
    source.providerId === provider.id &&
    source.providerName === provider.name &&
    Number.isFinite(source.episodeNumber) &&
    source.episodeNumber > 0 &&
    (!region || !source.blockedRegions?.includes(region.toUpperCase())) &&
    ((provider.regionPolicy === 'iframe-enforced' &&
      !!source.embedUrl &&
      !source.playbackUrl &&
      !source.qualities?.length) ||
      (provider.regionPolicy === 'provider-response' && source.regionChecked === true) ||
      source.availableRegions.includes('*') ||
      (!!region && source.availableRegions.includes(region.toUpperCase()))) &&
    (!source.embedUrl ||
      (rights.embeddingAllowed && allowedUrl(source.embedUrl, rights.allowedEmbedOrigins))) &&
    (!source.playbackUrl ||
      (rights.playbackAllowed && allowedUrl(source.playbackUrl, rights.allowedPlaybackOrigins))) &&
    (!source.qualities?.length ||
      (rights.playbackAllowed &&
        source.qualities.every((q) => allowedUrl(q.url, rights.allowedPlaybackOrigins)))) &&
    !!(source.embedUrl || source.playbackUrl)
  );
}
export async function getVideoSources(
  animeId: string,
  region?: string,
  providers: ReadonlyArray<VideoProvider> = approvedProviders,
): Promise<VideoSource[]> {
  const sources: VideoSource[] = [];
  for (const provider of providers) {
    try {
      sources.push(
        ...(await provider.getSources(animeId)).filter(
          (source) => source.animeId === animeId && isAuthorizedSource(source, provider, region),
        ),
      );
    } catch {
      /* One unavailable provider must not enable playback or break the catalog. */
    }
  }
  return sources;
}
