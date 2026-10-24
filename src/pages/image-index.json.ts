import type { APIRoute } from 'astro';
import { anime } from '../data/anime';
import { imageUrl } from '../lib/images';
import { experimentalPosters } from '../lib/image-mode';
export const GET: APIRoute = () =>
  Response.json({
    version: 2,
    sharded: anime.some((a) => a.imageSource === 'Shikimori'),
    experimental: experimentalPosters,
    buckets: [
      ...new Set(
        anime
          .filter((a) => a.imageSource === 'Shikimori' && a.posterUrl)
          .map((a) => Math.floor(a.shikimoriId / 1000)),
      ),
    ],
    images: Object.fromEntries(
      anime
        .filter((a) => a.imageSource !== 'Shikimori' && a.posterUrl)
        .map((a) => [
          a.shikimoriId,
          {
            poster: imageUrl(a.poster, import.meta.env.BASE_URL),
            posterUrl: a.posterUrl ? imageUrl(a.posterUrl, import.meta.env.BASE_URL) : null,
            posterDetailUrl: a.posterDetailUrl
              ? imageUrl(a.posterDetailUrl, import.meta.env.BASE_URL)
              : null,
            backdropUrl: a.backdropUrl ? imageUrl(a.backdropUrl, import.meta.env.BASE_URL) : null,
            imageSource: a.imageSource,
            imageAttribution: a.imageAttribution,
            imageLicenseStatus: a.imageLicenseStatus,
          },
        ]),
    ),
  });
