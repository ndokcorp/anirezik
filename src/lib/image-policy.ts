import sources from '../data/image-sources.json' with { type: 'json' };
import { resolveImages } from './images';

export interface PosterSource {
  status: string;
  allowedOrigins: string[];
  attribution: string;
  evidence: string;
  hotlinking: boolean | null;
  browserCaching: boolean | null;
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
    source.browserCaching === true
  );
}
function exactPosterUrl(value: string | null | undefined, source: PosterSource) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      source.allowedOrigins.includes(parsed.origin)
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
) {
  const original = resolveImages(a.shikimoriId);
  if (!experimental && !sourceApproved(source))
    return { ...original, posterDetailUrl: original.posterUrl };
  const main = exactPosterUrl(a.sourcePosterMainUrl, source);
  const detail = exactPosterUrl(a.sourcePosterUrl, source);
  if (!main && !detail) return { ...original, posterDetailUrl: original.posterUrl };
  const attribution = experimental
    ? 'Shikimori · локальный эксперимент; права на публикацию не подтверждены'
    : source.attribution;
  return {
    ...original,
    poster: main || detail!,
    posterUrl: main || detail!,
    posterDetailUrl: detail || main!,
    banner: original.bannerUrl || main || detail!,
    imageSource: 'Shikimori',
    imageAttribution: original.bannerUrl
      ? `${attribution}; фон: ${original.imageAttribution}`
      : attribution,
    posterAttribution: attribution,
    imageLicenseStatus: experimental
      ? ('local-experiment' as const)
      : ('permission-granted' as const),
  };
}
