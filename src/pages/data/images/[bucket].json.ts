import type { APIRoute, GetStaticPaths } from 'astro';
import { anime } from '../../../data/anime';
import { imageUrl } from '../../../lib/images';
const buckets = new Map<number, typeof anime>();
for (const a of anime) {
  if (a.imageSource !== 'Shikimori' || !a.posterUrl) continue;
  const bucket = Math.floor(a.shikimoriId / 1000);
  if (!buckets.has(bucket)) buckets.set(bucket, []);
  buckets.get(bucket)!.push(a);
}
export const getStaticPaths: GetStaticPaths = () =>
  [...buckets].map(([bucket, entries]) => ({
    params: { bucket: String(bucket) },
    props: { entries },
  }));
export const GET: APIRoute = ({ props }) =>
  Response.json(
    Object.fromEntries(
      (props.entries as typeof anime).map((a) => [
        a.shikimoriId,
        {
          poster: imageUrl(a.poster, import.meta.env.BASE_URL),
          posterUrl: a.posterUrl,
          posterDetailUrl: a.posterDetailUrl,
          backdropUrl: a.backdropUrl ? imageUrl(a.backdropUrl, import.meta.env.BASE_URL) : null,
          imageSource: a.imageSource,
          imageAttribution: a.imageAttribution,
          imageLicenseStatus: a.imageLicenseStatus,
        },
      ]),
    ),
  );
