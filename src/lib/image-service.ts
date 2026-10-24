import { url } from './paths';
export interface ClientImages {
  poster: string;
  posterUrl: string | null;
  posterDetailUrl?: string | null;
  backdropUrl: string | null;
  imageSource: string | null;
  imageAttribution: string | null;
  imageLicenseStatus: 'unknown' | 'original-ai' | 'permission-granted' | 'local-experiment';
  bannerPosition?: string;
}
interface ImageIndex {
  images: Record<string, ClientImages>;
  sharded: boolean;
  buckets?: number[];
}
let loaded: Promise<ImageIndex> | undefined;
const buckets = new Map<number, Promise<Record<string, ClientImages>>>();
export async function loadImages(ids: number[] = []): Promise<Record<string, ClientImages>> {
  const index = await (loaded ||= fetch(url('image-index.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error('Изображения недоступны');
      const index = (await response.json()) as ImageIndex;
      if (!index || typeof index.images !== 'object' || !index.images)
        throw new Error('image schema');
      return index;
    })
    .catch(() => {
      loaded = undefined;
      return { images: {}, sharded: false };
    }));
  if (!index.sharded || !ids.length) return index.images;
  const wanted = [...new Set(ids.map((id) => Math.floor(id / 1000)))].filter((bucket) =>
    index.buckets?.includes(bucket),
  );
  const result = { ...index.images };
  for (let offset = 0; offset < wanted.length; offset += 3) {
    await Promise.all(
      wanted.slice(offset, offset + 3).map(async (bucket) => {
        if (!buckets.has(bucket))
          buckets.set(
            bucket,
            fetch(url(`data/images/${bucket}.json`))
              .then(async (r) => {
                if (!r.ok) throw new Error('image package');
                return (await r.json()) as Record<string, ClientImages>;
              })
              .catch(() => {
                buckets.delete(bucket);
                return {};
              }),
          );
        Object.assign(result, await buckets.get(bucket));
      }),
    );
  }
  return result;
}
export const fallbackImages = (): ClientImages => ({
  poster: url('assets/poster-placeholder.svg'),
  posterUrl: null,
  backdropUrl: null,
  imageSource: null,
  imageAttribution: null,
  imageLicenseStatus: 'unknown',
});
