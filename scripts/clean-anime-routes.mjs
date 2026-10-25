import { animeRoute } from '../src/lib/paths.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
/** GitHub Pages has no server rewrites. Keep one full universal shell and tiny bootstrap/legacy documents. */
export default function cleanAnimeRoutes() {
  let base = '/',
    site = 'https://example.com';
  return {
    name: 'anirezik-clean-anime-routes',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base.replace(/\/$/, '');
        site = config.site || site;
      },
      'astro:server:setup': async ({ server }) => {
        const { anime } = JSON.parse(await readFile('src/data/catalog.json', 'utf8'));
        const statics = new Set(
          JSON.parse(await readFile('src/data/static-page-ids.json', 'utf8')),
        );
        const ids = new Set(anime.map((a) => a.shikimoriId));
        const aliases = new Map(anime.map((a) => [a.slug, a.shikimoriId]));
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          const match = /\/anime\/([^/]+)\/?$/.exec(path);
          if (!match) return next();
          const segment = match[1];
          const id = /^\d+$/.test(segment)
            ? Number(segment)
            : aliases.get(segment) || Number(/^shikimori-(\d+)$/.exec(segment)?.[1]);
          if (!ids.has(id)) return next();
          if (!/^\d+$/.test(segment)) {
            res.writeHead(302, { Location: `${base}/${animeRoute(id)}` });
            res.end();
            return;
          }
          if (!statics.has(id)) req.url = `${base}/anime/?id=${id}`;
          next();
        });
      },
      'astro:build:done': async ({ dir }) => {
        const output = fileURLToPath(dir);
        const { anime } = JSON.parse(await readFile('src/data/catalog.json', 'utf8'));
        const statics = new Set(
          JSON.parse(await readFile('src/data/static-page-ids.json', 'utf8')),
        );
        const esc = (s) =>
          String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        let redirects = 0,
          bootstraps = 0;
        const put = async (segment, a, legacy) => {
          const canonical = `${base}/${animeRoute(a.shikimoriId)}`;
          const target = legacy ? canonical : `${base}/anime/?id=${a.shikimoriId}`;
          const absolute = new URL(canonical, site).href;
          const schema = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: a.title,
            url: absolute,
            identifier: { '@type': 'PropertyValue', propertyID: 'Shikimori', value: a.shikimoriId },
          }).replaceAll('<', '\\u003c');
          const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a.title)} — AniRezik</title><link rel="canonical" href="${esc(absolute)}"><meta property="og:url" content="${esc(absolute)}"><meta property="og:title" content="${esc(a.title)} — AniRezik">${legacy ? '<meta name="robots" content="noindex">' : `<script type="application/ld+json">${schema}</script>`}<meta http-equiv="refresh" content="0;url=${esc(target)}"><script>const target=new URL(${JSON.stringify(target)},location.origin);target.hash=location.hash;location.replace(target.href);</script></head><body><a href="${esc(target)}">Открыть ${esc(a.title)}</a></body></html>`;
          const folder = join(output, 'anime', segment);
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, 'index.html'), html);
        };
        // Bounded disk writes, no network requests or duplicated catalog payloads.
        for (let offset = 0; offset < anime.length; offset += 32)
          await Promise.all(
            anime.slice(offset, offset + 32).map(async (a) => {
              if (!statics.has(a.shikimoriId)) {
                await put(String(a.shikimoriId), a, false);
                bootstraps++;
              }
              const aliases = new Set([`shikimori-${a.shikimoriId}`, a.slug]);
              for (const alias of aliases)
                if (/^[a-z0-9-]+$/.test(alias) && alias !== String(a.shikimoriId)) {
                  await put(alias, a, true);
                  redirects++;
                }
            }),
          );
        await writeFile(
          join(output, 'route-migration.json'),
          JSON.stringify({
            version: '0.4.6',
            numeric: anime.length,
            static: statics.size,
            bootstraps,
            legacyRedirects: redirects,
          }),
        );
        console.log(
          `Clean anime URLs: ${anime.length} numeric, ${redirects} legacy redirects; shared universal shell.`,
        );
      },
    },
  };
}
