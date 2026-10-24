import type { APIRoute } from 'astro';
import { anime, animeByShikimoriId, animePath } from '../../../data/anime';
import { url } from '../../../lib/paths';
export const getStaticPaths = () =>
  anime.map((a) => ({ params: { id: String(a.shikimoriId) }, props: { a } }));
export const GET: APIRoute = ({ props }) => {
  const a = props.a as (typeof anime)[number];
  // Image URLs/permissions are independent of detail data. Unknown source URLs never reach img.
  const {
    poster,
    banner,
    posterUrl,
    posterDetailUrl,
    bannerUrl,
    backdropUrl,
    imageSource,
    imageAttribution,
    imageLicenseStatus,
    bannerPosition,
    sourcePosterUrl,
    sourcePosterMainUrl,
    posterAttribution,
    ...detail
  } = a;
  return Response.json({
    ...detail,
    related: a.related.map((relation) => {
      const local = animeByShikimoriId.get(relation.shikimoriId);
      return {
        ...relation,
        href: local ? url(animePath(local)) : relation.sourceUrl,
        external: !local,
        score: local?.score ?? null,
      };
    }),
  });
};
