import manifest from '../data/image-rights.json' with { type: 'json' };
export interface ImagePermission {
  posterUrl?: string;
  bannerUrl?: string;
  backdropUrl?: string;
  imageSource?: string;
  bannerPosition?: string;
  imageAttribution: string;
  imageLicenseStatus: 'original-ai' | 'permission-granted' | 'unknown';
  evidence: string;
}
export const imageFallback = '/assets/poster-placeholder.svg';
export function resolveImages(
  id: number,
  entries: Record<string, ImagePermission> = manifest as Record<string, ImagePermission>,
) {
  const item = entries[id];
  const allowed =
    item && item.imageLicenseStatus !== 'unknown' && !!item.evidence && !!item.imageAttribution;
  const safe = (value?: string) =>
    value && ((value.startsWith('/assets/') && !value.includes('..')) || /^https:\/\//.test(value))
      ? value
      : null;
  const posterUrl = allowed ? safe(item.posterUrl) : null;
  const bannerUrl = allowed ? safe(item.backdropUrl || item.bannerUrl) : null;
  return {
    posterUrl,
    bannerUrl,
    backdropUrl: bannerUrl,
    imageSource: allowed
      ? item.imageSource || (item.imageLicenseStatus === 'original-ai' ? 'AniRezik' : null)
      : null,
    bannerPosition: allowed ? item.bannerPosition || 'center' : 'center',
    imageAttribution: allowed ? item.imageAttribution : null,
    imageLicenseStatus: allowed ? item.imageLicenseStatus : ('unknown' as const),
    poster: posterUrl || imageFallback,
    banner: bannerUrl || posterUrl || imageFallback,
    posterAttribution: allowed ? item.imageAttribution : null,
  };
}
export const imageUrl = (path: string, base: string) =>
  /^https:\/\//.test(path) ? path : `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
