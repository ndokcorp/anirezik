import type { APIRoute } from 'astro';
import { anime, staticPageIds } from '../../../data/anime';
import { packIndex } from '../../../lib/catalog-index';
const buckets = new Map<number, typeof anime>();
for (const item of anime) {
  const key = Math.floor(item.shikimoriId / 1000);
  const group = buckets.get(key) || [];
  group.push(item);
  buckets.set(key, group);
}
export const getStaticPaths = () =>
  [...buckets].map(([bucket, items]) => ({ params: { bucket: String(bucket) }, props: { items } }));
export const GET: APIRoute = ({ props }) => Response.json(packIndex(props.items, staticPageIds));
