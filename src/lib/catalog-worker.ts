/// <reference lib="webworker" />
import { unpackIndex, type CatalogEntry, type PackedIndex } from './catalog-index';
import { createAnimeSearch } from './search';
export interface CatalogRequest {
  mode: 'search' | 'catalog' | 'favorites';
  query?: string;
  filters?: Record<string, string>;
  ids?: string[];
  limit?: number;
  offset?: number;
}
export interface CatalogResult {
  entries: CatalogEntry[];
  total: number;
  count: number;
  unavailable: number;
}
let loaded:
  | Promise<{
      entries: CatalogEntry[];
      find: ReturnType<typeof createAnimeSearch<CatalogEntry>>;
      byId: Map<string, CatalogEntry>;
    }>
  | undefined;
function load(indexUrl: string, base: string) {
  return (loaded ||= (async () => {
    const compressed = typeof DecompressionStream === 'function';
    const response = await fetch(compressed ? indexUrl.replace(/\.json$/, '.bin') : indexUrl);
    if (!response.ok) throw new Error(`Индекс недоступен: HTTP ${response.status}`);
    const data = compressed
      ? await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).json()
      : await response.json();
    const entries = unpackIndex(data as PackedIndex, base);
    return {
      entries,
      find: createAnimeSearch(entries),
      byId: new Map(entries.map((a) => [a.id, a])),
    };
  })().catch((error) => {
    loaded = undefined;
    throw error;
  }));
}
self.onmessage = async (
  event: MessageEvent<{ id: number; indexUrl: string; base: string; request: CatalogRequest }>,
) => {
  const { id, indexUrl, base, request } = event.data;
  try {
    const index = await load(indexUrl, base);
    let matches: CatalogEntry[];
    let unavailable = 0;
    if (request.mode === 'search') matches = index.find(request.query || '');
    else if (request.mode === 'favorites') {
      matches = (request.ids || [])
        .map((id) => index.byId.get(id))
        .filter((a): a is CatalogEntry => !!a);
      unavailable = (request.ids || []).length - matches.length;
    } else {
      const f = request.filters || {};
      matches = (request.query ? index.find(request.query) : index.entries).filter(
        (a) =>
          (!f.genre || a.genres.includes(f.genre)) &&
          (!f.year || String(a.year) === f.year) &&
          (!f.type || a.type === f.type) &&
          (!f.status || a.status === f.status) &&
          (!f.studio || a.studios.includes(f.studio)),
      );
      if (f.sort === 'title') matches.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
      if (f.sort === 'year') matches.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      if (f.sort === 'rating') matches.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
    const offset = request.offset || 0;
    self.postMessage({
      id,
      result: {
        entries: matches.slice(offset, offset + (request.limit || 24)),
        total: matches.length,
        count: index.entries.length,
        unavailable,
      } satisfies CatalogResult,
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
