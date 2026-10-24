// Opt-in local development check. Real CDN requests; no API requests and no image downloads to assets.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const origin = process.env.ANIREZIK_TEST_URL || 'http://127.0.0.1:4321/';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))
  throw new Error('Localhost required');
const anime = JSON.parse(await readFile('src/data/catalog.json', 'utf8')).anime;
const used = new Set(),
  sample = [];
function add(category, rows, limit) {
  for (const a of rows) {
    if (sample.filter((x) => x.category === category).length >= limit) break;
    if (used.has(a.shikimoriId) || !a.sourcePosterMainUrl) continue;
    used.add(a.shikimoriId);
    sample.push({ id: a.shikimoriId, title: a.title, year: a.year, category });
  }
}
add(
  'required',
  [1, 5, 59193].map((id) => anime.find((a) => a.shikimoriId === id)).filter(Boolean),
  3,
);
add(
  'popular',
  [52299, 16498, 1535, 20, 38000, 44511, 5114, 21, 1, 40748]
    .map((id) => anime.find((a) => a.shikimoriId === id))
    .filter(Boolean),
  7,
);
add(
  'old',
  anime.filter((a) => a.year && a.year < 1980).sort((a, b) => a.year - b.year),
  10,
);
add(
  'rare',
  anime.filter((a) => ['cm', 'pv', 'music'].includes(a.kind) && (!a.score || a.score < 5)),
  5,
);
add(
  'movie',
  anime.filter((a) => a.kind === 'movie').sort((a, b) => (b.score || 0) - (a.score || 0)),
  5,
);
if (sample.length !== 30) throw new Error('Need 30 distinct samples');
const browser = await chromium.launch();
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  mode: 'local-experiment, not permission',
  apiRequests: [],
  sample,
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on('request', (r) => {
    if (/shikimori\.[^/]+\/api\//.test(r.url())) report.apiRequests.push(r.url());
  });
  const page = await context.newPage();
  await page.goto(new URL('about/', origin).href);
  const config = await page.evaluate(
    async (base) => await (await fetch(new URL('image-index.json', base))).json(),
    origin,
  );
  if (!config.experimental || !config.sharded)
    throw new Error('Run npm run dev:posters first. Production must not enable this.');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const network = [];
  let cacheHits = 0;
  cdp.on('Network.responseReceived', (e) => {
    if (e.type === 'Image')
      network.push({
        url: e.response.url,
        status: e.response.status,
        fromDiskCache: !!e.response.fromDiskCache,
        cacheControl:
          e.response.headers['cache-control'] || e.response.headers['Cache-Control'] || null,
      });
  });
  cdp.on('Network.requestServedFromCache', () => cacheHits++);
  const start = Date.now();
  report.results = await page.evaluate(
    async ({ sample, origin }) => {
      const images = {};
      for (const bucket of new Set(sample.map((a) => Math.floor(a.id / 1000))))
        Object.assign(
          images,
          await (await fetch(new URL(`data/images/${bucket}.json`, origin))).json(),
        );
      document.querySelector('main').replaceChildren();
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:12px';
      document.querySelector('main').append(grid);
      const results = [];
      for (let offset = 0; offset < sample.length; offset += 3)
        await Promise.all(
          sample.slice(offset, offset + 3).map(async (a) => {
            const src = images[a.id]?.poster;
            if (!src) {
              results.push({ ...a, ok: false, error: 'No resolved poster' });
              return;
            }
            const figure = document.createElement('figure'),
              img = document.createElement('img'),
              caption = document.createElement('figcaption');
            img.width = 400;
            img.height = 600;
            img.decoding = 'async';
            img.loading = 'lazy';
            img.style.cssText = 'width:100%;height:auto;object-fit:cover';
            img.alt = a.title;
            caption.textContent = `${a.id} · ${a.title}`;
            figure.append(img, caption);
            grid.append(figure);
            // Bring the lazy img to the viewport before waiting for its real decode.
            img.src = src;
            img.scrollIntoView();
            const started = performance.now();
            try {
              await Promise.race([
                img.decode(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('decode timeout')), 25000),
                ),
              ]);
              results.push({
                ...a,
                url: src,
                detailUrl: images[a.id].posterDetailUrl,
                ok: img.naturalWidth > 0,
                width: img.naturalWidth,
                height: img.naturalHeight,
                ms: Math.round(performance.now() - started),
              });
            } catch (error) {
              results.push({ ...a, url: src, ok: false, error: String(error) });
            }
          }),
        );
      window.scrollTo(0, 0);
      return results;
    },
    { sample, origin },
  );
  report.wallMs = Date.now() - start;
  report.decoded = report.results.filter((x) => x.ok).length;
  report.network = network;
  await page.screenshot({ path: '.cache/shikimori-local-gallery.png', fullPage: true });
  // Reopen through the same browser cache. Never append cache-busters or override CDN headers.
  report.cacheBeforeRepeat = cacheHits;
  const responsesBeforeRepeat = network.length;
  await page.goto(new URL('about/', origin).href);
  report.repeat = await page.evaluate(
    async (rows) => {
      const out = [];
      for (const row of rows) {
        const img = new Image();
        img.src = row.url;
        try {
          await Promise.race([
            img.decode(),
            new Promise((_, r) => setTimeout(() => r(Error('timeout')), 20000)),
          ]);
          out.push({ id: row.id, ok: true });
        } catch {
          out.push({ id: row.id, ok: false });
        }
      }
      return out;
    },
    report.results.filter((x) => x.ok),
  );
  report.repeatCacheEvents = cacheHits - report.cacheBeforeRepeat;
  report.repeatNetworkResponses = network
    .slice(responsesBeforeRepeat)
    .filter((x) => x.url.includes('/uploads/poster/'));
  report.imageResources = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'img')
      .map((e) => ({
        url: e.name,
        transferSize: e.transferSize,
        durationMs: Math.round(e.duration),
      })),
  );
  // Full quality detail path through the actual UI, including a rare title outside the old 3000.
  await page.goto(new URL('anime/?id=3929', origin).href);
  await page.locator('.detail-poster').waitFor();
  report.detail = await page.locator('.detail-poster').evaluate(async (img) => {
    try {
      await img.decode();
      return {
        src: img.currentSrc,
        ok: img.naturalWidth > 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    } catch {
      return { src: img.currentSrc, ok: false };
    }
  });
  await page.screenshot({ path: '.cache/shikimori-local-detail.png', fullPage: true });
  // Exercise the real UI without fetching any metadata API, beyond the gallery.
  const flowRequests = [];
  context.on('request', (r) => flowRequests.push(r.url()));
  await page.locator('.detail-copy [data-favorite]').click();
  await page.goto(new URL('favorites/', origin).href);
  await expect(page.locator('#favorites-grid article')).toHaveCount(1);
  const favoritePoster = page.locator('#favorites-grid img');
  await favoritePoster.scrollIntoViewIfNeeded();
  await expect(favoritePoster).toHaveAttribute('src', /^https:\/\/shikimori.io\//);
  await favoritePoster.evaluate(async (img) => await img.decode());
  await page.setViewportSize({ width: 390, height: 844 });
  const beforeCatalog = flowRequests.length;
  await page.goto(new URL('catalog/', origin).href);
  await expect(page.locator('#catalog-grid article')).toHaveCount(24);
  await page.locator('#catalog-grid article').first().scrollIntoViewIfNeeded();
  await expect(page.locator('#catalog-grid img').first()).toHaveAttribute(
    'src',
    /^https:\/\/shikimori.io\//,
  );
  await page.waitForLoadState('networkidle');
  const catalogRemote = flowRequests
    .slice(beforeCatalog)
    .filter((u) => u.startsWith('https://shikimori.io/'));
  expect(catalogRemote.length).toBeLessThan(24);
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  await page.getByRole('combobox').fill('Лиса против Енота');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.getByRole('option').first().click();
  await expect(page.locator('.detail-copy h1')).toHaveText('Лиса против Енота');
  report.uiFlow = {
    cards: 24,
    catalogRemoteRequests: catalogRemote.length,
    totalRequests: flowRequests.length,
    imagePackages: flowRequests.filter((u) => /\/data\/images\//.test(u)).length,
    metadataApiRequests: flowRequests.filter((u) => /shikimori\.[^/]+\/api\//.test(u)).length,
    favoritesDecoded: true,
    rareDetailReopened: true,
  };
  await context.close();
  const slow = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  slow.on('request', (r) => {
    if (/shikimori\.[^/]+\/api\//.test(r.url())) report.apiRequests.push(r.url());
  });
  const slowPage = await slow.newPage(),
    slowCdp = await slow.newCDPSession(slowPage);
  await slowCdp.send('Network.enable');
  await slowCdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 50000,
    uploadThroughput: 20000,
    connectionType: 'cellular3g',
  });
  await slowCdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let slowBytes = 0;
  slowCdp.on('Network.loadingFinished', (e) => (slowBytes += e.encodedDataLength));
  await slowPage.goto(new URL('about/', origin).href);
  const before = slowBytes,
    slowStart = Date.now();
  report.slowSample = await slowPage.evaluate(
    async (rows) => {
      const main = document.querySelector('main');
      main.replaceChildren();
      const out = [];
      for (const row of rows) {
        const img = document.createElement('img');
        img.width = 160;
        img.height = 240;
        img.style.objectFit = 'cover';
        img.decoding = 'async';
        img.src = row.url;
        main.append(img);
        const started = performance.now();
        try {
          await Promise.race([
            img.decode(),
            new Promise((_, r) => setTimeout(() => r(Error('timeout')), 30000)),
          ]);
          out.push({
            id: row.id,
            ok: img.naturalWidth > 0,
            ms: Math.round(performance.now() - started),
          });
        } catch {
          out.push({ id: row.id, ok: false });
        }
      }
      return out;
    },
    [0, 1, 10, 11, 20, 25]
      .map((i) => report.results.find((r) => r.id === sample[i].id))
      .filter((r) => r?.ok),
  );
  report.slow = {
    profile: '390x844, 50 000 B/s, latency400ms, CPUx4, fresh context',
    wallMs: Date.now() - slowStart,
    bytes: slowBytes - before,
  };
  await slow.close();
} finally {
  await browser.close();
}
await mkdir('docs/research', { recursive: true });
await writeFile('docs/research/remote-posters-local.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      decoded: report.decoded,
      total: sample.length,
      wallMs: report.wallMs,
      apiRequests: report.apiRequests.length,
      repeatCacheEvents: report.repeatCacheEvents,
      detail: report.detail,
    },
    null,
    2,
  ),
);
