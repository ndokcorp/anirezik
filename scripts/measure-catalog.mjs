import { chromium } from '@playwright/test';
import { writeFile, stat } from 'node:fs/promises';
const origin = process.env.ANIREZIK_TEST_URL || 'http://127.0.0.1:4322/';
const browser = await chromium.launch();
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  conditions: {
    viewport: '390x844',
    cpu: 4,
    latencyMs: 400,
    downloadBytesPerSecond: 50000,
    uploadBytesPerSecond: 20000,
  },
  apiRequests: [],
};
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 50000,
    uploadThroughput: 20000,
  });
  const requests = [];
  const sizes = new Map();
  let phase = 'initial';
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!e.request.url.startsWith('http')) return;
    requests.push({ id: e.requestId, url: e.request.url, phase });
    if (/shikimori\.[^/]+\/api\//.test(e.request.url)) report.apiRequests.push(e.request.url);
  });
  cdp.on('Network.loadingFinished', (e) => sizes.set(e.requestId, e.encodedDataLength));
  const start = performance.now();
  await page.goto(new URL('catalog/', origin).href, { waitUntil: 'networkidle', timeout: 120000 });
  report.initial = {
    ms: Math.round(performance.now() - start),
    cards: await page.locator('#catalog-grid article').count(),
    domNodes: await page.locator('*').count(),
  };
  phase = 'visible';
  await page.locator('#catalog-grid article').first().scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  report.visible = { requests: requests.filter((r) => r.phase === 'visible').length };
  const images = await page.locator('#catalog-grid img').evaluateAll(async (imgs) => {
    const visible = imgs.filter(
      (i) =>
        i.getBoundingClientRect().top < innerHeight + 160 && i.getBoundingClientRect().bottom > 0,
    );
    return Promise.all(
      visible.map(async (i) => {
        const t = performance.now();
        try {
          await i.decode();
          return {
            url: i.currentSrc,
            ms: Math.round(performance.now() - t),
            width: i.naturalWidth,
            ok: true,
          };
        } catch {
          return { url: i.src, ms: Math.round(performance.now() - t), ok: false };
        }
      }),
    );
  });
  report.visible.images = images;
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  phase = 'search';
  const searchStart = performance.now();
  await page.getByRole('combobox').fill('Namakura Gatana');
  await page.locator('#search-results [role=option]').first().waitFor({ timeout: 120000 });
  const workerResources = await page
    .workers()[0]
    .evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((r) => ({
          url: r.name,
          bytes: r.transferSize,
          encodedBytes: r.encodedBodySize,
          durationMs: Math.round(r.duration),
        })),
    );
  report.workerRequests = workerResources;
  report.search = {
    ms: Math.round(performance.now() - searchStart),
    indexJsonBytes: (await stat('dist/search-index.json')).size,
    indexGzipBytes: (await stat('dist/search-index.bin')).size,
  };
  phase = 'repeat-search';
  await page.getByRole('combobox').fill('Naruto');
  await page.getByRole('option').first().waitFor();
  await page.waitForLoadState('networkidle');
  report.requestsByPhase = Object.fromEntries(
    ['initial', 'visible', 'search', 'repeat-search'].map((p) => {
      const rows = requests.filter((r) => r.phase === p);
      return [
        p,
        {
          count: rows.length,
          bytes: rows.reduce((n, r) => n + (sizes.get(r.id) || 0), 0),
          urls: rows.map((r) => r.url),
        },
      ];
    }),
  );
  for (const resource of workerResources) {
    if (!requests.some((r) => r.url === resource.url)) {
      report.requestsByPhase.search.count++;
      report.requestsByPhase.search.bytes += resource.bytes;
      report.requestsByPhase.search.urls.push(resource.url);
    }
  }
  report.totalBytes = Object.values(report.requestsByPhase).reduce((n, p) => n + p.bytes, 0);
  report.totalRequests = Object.values(report.requestsByPhase).reduce((n, p) => n + p.count, 0);
  report.initial.htmlBytes = (await stat('dist/catalog/index.html')).size;
  await writeFile(
    'docs/research/catalog-performance-0.3.2.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
