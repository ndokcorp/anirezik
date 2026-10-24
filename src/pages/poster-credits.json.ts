import type { APIRoute } from 'astro';
import { anime } from '../data/anime';
import permissions from '../data/image-rights.json';
import type { ImagePermission } from '../lib/images';

// Keep the separately attributed TVmaze collection reusable under ShareAlike.
export const GET: APIRoute = () =>
  Response.json({
    source: 'TVmaze',
    sourceUrl: 'https://www.tvmaze.com/api',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    changes:
      'Shikimori ID mapping; browser CSS crops, blurs and darkens presentation. Original files unchanged.',
    posters: anime
      .filter((a) => (permissions as Record<string, ImagePermission>)[a.shikimoriId]?.remotePoster)
      .map((a) => ({
        shikimoriId: a.shikimoriId,
        active: a.imageSource === 'TVmaze',
        ...(permissions as Record<string, ImagePermission>)[a.shikimoriId].remotePoster,
      })),
  });
