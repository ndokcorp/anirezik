import { animeRoute } from './src/lib/paths.ts';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cleanAnimeRoutes from './scripts/clean-anime-routes.mjs';
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync('src/data/catalog.json', 'utf8')).anime;
const canonicalBase = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const canonicalSite = process.env.SITE_URL || 'https://example.com';
export default defineConfig({
  site: process.env.SITE_URL || 'https://example.com',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    cleanAnimeRoutes(),
    sitemap({
      filter: (page) => !/\/anime\/$|\/anime\/(?!\d+\/)[^/]+\/$/.test(new URL(page).pathname),
      customPages: rows.map(
        (a) => new URL(`${canonicalBase}/${animeRoute(a.shikimoriId)}`, canonicalSite).href,
      ),
    }),
  ],
  devToolbar: { enabled: false },
});
