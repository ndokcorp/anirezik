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
const failedUntil = new Map<number, number>();
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    const start = () => {
      active++;
      resolve();
    };
    if (active < 3) start();
    else queue.push(start);
  });
  try {
    return await run();
  } finally {
    active--;
    queue.shift()?.();
  }
}
function imageRecord(value: unknown): value is ClientImages {
  if (!value || typeof value !== 'object') return false;
  const a = value as ClientImages;
  return (
    typeof a.poster === 'string' &&
    ['unknown', 'original-ai', 'permission-granted', 'local-experiment'].includes(
      a.imageLicenseStatus,
    ) &&
    [a.poster, a.posterUrl, a.posterDetailUrl, a.backdropUrl].every(
      (v) =>
        v == null ||
        (typeof v === 'string' &&
          ((v.startsWith('/') && !v.startsWith('//')) || /^https:\/\//.test(v))),
    )
  );
}
function imagePackage(value: unknown): Record<string, ClientImages> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.entries(value).every(([key, a]) => /^\d+$/.test(key) && imageRecord(a))
  )
    throw new Error('Invalid image package');
  return value as Record<string, ClientImages>;
}
export async function loadImages(ids: number[] = []): Promise<Record<string, ClientImages>> {
  const index = await (loaded ||= fetch(url('image-index.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error('Изображения недоступны');
      const index = (await response.json()) as ImageIndex;
      if (!index || typeof index.images !== 'object' || !index.images)
        throw new Error('image schema');
      imagePackage(index.images);
      if (
        index.sharded &&
        (!Array.isArray(index.buckets) || !index.buckets.every(Number.isSafeInteger))
      )
        throw new Error('image buckets');
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
        if ((failedUntil.get(bucket) || 0) > Date.now()) return;
        if (!buckets.has(bucket))
          buckets.set(
            bucket,
            limited(() =>
              fetch(url(`data/images/${bucket}.json`))
                .then(async (r) => {
                  if (!r.ok) throw new Error('image package');
                  return imagePackage(await r.json());
                })
                .catch(() => {
                  buckets.delete(bucket);
                  failedUntil.set(bucket, Date.now() + 30000);
                  return {};
                }),
            ),
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
