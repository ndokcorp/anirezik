import type { APIRoute } from 'astro';
import { gzipSync } from 'node:zlib';
import { anime, staticPageIds } from '../data/anime';
import { packIndex } from '../lib/catalog-index';
// A binary extension avoids relying on hosting-specific Content-Encoding behavior.
export const GET: APIRoute = () =>
  new Response(new Uint8Array(gzipSync(JSON.stringify(packIndex(anime, staticPageIds)))), {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
