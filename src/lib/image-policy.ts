import sources from '../data/image-sources.json' with { type: 'json' };
import permissions from '../data/image-rights.json' with { type: 'json' };
import { resolveImages, imageFallback, type ImagePermission } from './images';

export interface PosterSource {
  status: string;
  allowedOrigins: string[];
  attribution: string;
  evidence: string;
  hotlinking: boolean | null;
  browserCaching: boolean | null;
  browserCachePolicy?: string;
  scope: { kind: string; animeIds?: number[]; urls?: string[] };
  expiresAt?: string | null;
}
export function localPosterExperiment(dev: boolean, flag: string | undefined, ci = false) {
  return dev && flag === '1' && !ci;
}
export function sourceApproved(source: PosterSource) {
  return (
    source.status === 'permission-granted' &&
    !!source.evidence.trim() &&
    !!source.attribution.trim() &&
    source.hotlinking === true &&
    (source.browserCaching === true ||
      (source.browserCaching === null && source.browserCachePolicy === 'http-response-headers')) &&
    ['all', 'ids', 'urls'].includes(source.scope?.kind) &&
    (!source.expiresAt ||
      (Number.isFinite(Date.parse(source.expiresAt)) && Date.parse(source.expiresAt) > Date.now()))
  );
}
function exactPosterUrl(
  value: string | null | undefined,
  source: PosterSource,
  id: number,
  experimental: boolean,
) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      source.allowedOrigins.includes(parsed.origin) &&
      (experimental ||
        source.scope.kind === 'all' ||
        (source.scope.kind === 'ids' && source.scope.animeIds?.includes(id)) ||
        (source.scope.kind === 'urls' && source.scope.urls?.includes(value)))
      ? value
      : null;
  } catch {
    return null;
  }
}
export function resolveCatalogImages(
  a: { shikimoriId: number; sourcePosterMainUrl?: string | null; sourcePosterUrl?: string | null },
  experimental = false,
  source: PosterSource = sources.shikimori,
  alternativeSource: PosterSource = sources.tvmaze,
) {
  let original = resolveImages(a.shikimoriId);
  const backgroundAttribution = original.imageAttribution;
  // AI artwork is retired; only approved real posters or the neutral placeholder remain.
  if (original.imageLicenseStatus === 'original-ai') {
    original = {
      ...original,
      poster: imageFallback,
      banner: imageFallback,
      bannerUrl: null,
      backdropUrl: null,
      posterUrl: null,
      posterDetailUrl: null,
      posterAttribution: null,
      imageSource: null,
      imageAttribution: null,
      imageLicenseStatus: 'unknown',
    };
  }
  const item = (permissions as Record<string, ImagePermission>)[a.shikimoriId];
  const remote = item?.remotePoster;
  if (remote?.source === 'tvmaze' && remote.evidence.trim() && sourceApproved(alternativeSource)) {
    const main = exactPosterUrl(remote.posterUrl, alternativeSource, a.shikimoriId, false);
    const detail = exactPosterUrl(remote.posterDetailUrl, alternativeSource, a.shikimoriId, false);
    if (main || detail) {
      original = resolveImages(a.shikimoriId, {
        [a.shikimoriId]: {
          posterUrl: main || detail!,
          posterDetailUrl: detail || main!,
          backdropUrl: original.backdropUrl || undefined,
          bannerPosition: original.bannerPosition,
          imageSource: 'TVmaze',
          imageAttribution: original.backdropUrl
            ? `${remote.imageAttribution}; фон: ${original.imageAttribution}`
            : remote.imageAttribution,
          imageLicenseStatus: 'permission-granted',
          evidence: remote.evidence,
        },
      });
      original.posterAttribution = remote.imageAttribution;
    }
  }
  if (!experimental && !sourceApproved(source)) return original;
  const main = exactPosterUrl(a.sourcePosterMainUrl, source, a.shikimoriId, experimental);
  const detail = exactPosterUrl(a.sourcePosterUrl, source, a.shikimoriId, experimental);
  if (!main && !detail) return original;
  const attribution = experimental
    ? 'Shikimori · локальный эксперимент; права на публикацию не подтверждены'
    : source.attribution;
  return {
    ...original,
    poster: main || detail!,
    posterUrl: main || detail!,
    posterDetailUrl: detail || main!,
    posterRecoveryUrl: original.imageSource === 'TVmaze' ? original.posterUrl : null,
    banner: original.bannerUrl || main || detail!,
    imageSource: 'Shikimori',
    imageAttribution: original.bannerUrl
      ? `${attribution}; фон: ${backgroundAttribution}`
      : attribution,
    posterAttribution: attribution,
    imageLicenseStatus: experimental
      ? ('local-experiment' as const)
      : ('permission-granted' as const),
  };
}
