// Live UI verification; never grants rights or injects third-party URLs into production.
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const origin = process.env.ANIREZIK_TEST_URL || 'http://127.0.0.1:4321/';
const engines = { chromium, firefox, webkit };
const names = (process.env.ANIREZIK_TEST_BROWSERS || 'chromium,firefox,webkit').split(',');
const records = JSON.parse(await readFile('src/data/catalog.json', 'utf8')).anime;
const staticIds = new Set(JSON.parse(await readFile('src/data/static-page-ids.json', 'utf8')));
const required = [1, 5, 59193].map((id) => records.find((a) => a.shikimoriId === id));
const report = { checkedAt: new Date().toISOString(), origin, browsers: [], apiRequests: [] };
for (const name of names) {
  if (!engines[name]) throw new Error('Unknown browser');
  const result = { browser: name, checks: [], mode: null };
  report.browsers.push(result);
  let browser;
  try {
    browser = await engines[name].launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    context.on('request', (r) => {
      if (/shikimori\.[^/]+\/api\//.test(r.url())) report.apiRequests.push(r.url());
    });
    const config = await (
      await context.request.get(new URL('image-index.json', origin).href)
    ).json();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
    if (config.experimental && !local) throw new Error('Experimental source must be local');
    result.mode = config.experimental ? 'local-experiment' : 'production';
    const images = { ...config.images };
    for (const bucket of new Set(required.map((a) => Math.floor(a.shikimoriId / 1000)))) {
      if (config.sharded && config.buckets.includes(bucket))
        Object.assign(
          images,
          await (
            await context.request.get(new URL(`data/images/${bucket}.json`, origin).href)
          ).json(),
        );
    }
    if (required.some((a) => images[a.shikimoriId]?.imageSource !== 'Shikimori'))
      throw new Error(
        'Source not enabled for every required ID; real production permission must be supplied, not simulated',
      );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin);
      const home = page.locator('#popular .anime-card').first();
      const homeId = Number((await home.getAttribute('data-anime-id')).split(':')[1]);
      const homeBucket = Math.floor(homeId / 1000);
      if (!images[homeId] && config.sharded && config.buckets.includes(homeBucket))
        Object.assign(
          images,
          await (
            await context.request.get(new URL(`data/images/${homeBucket}.json`, origin).href)
          ).json(),
        );
      const homeImg = home.locator('img');
      await homeImg.scrollIntoViewIfNeeded();
      if (images[homeId]?.poster)
        await expect(homeImg).toHaveAttribute('src', images[homeId].poster);
      await expect
        .poll(() => homeImg.evaluate((i) => i.complete && i.naturalWidth > 0), { timeout: 30000 })
        .toBe(true);
      await homeImg.evaluate(async (i) => await i.decode());
      result.checks.push({
        surface: 'home',
        id: homeId,
        viewport: width,
        source: images[homeId]?.imageSource,
        ok: true,
      });
      for (const a of required) {
        await page.goto(new URL(`anime/?id=${a.shikimoriId}`, origin).href);
        const img = page.locator('.detail-poster'),
          wanted = images[a.shikimoriId].posterDetailUrl || images[a.shikimoriId].poster;
        await expect(img).toHaveAttribute('src', wanted);
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0), { timeout: 30000 })
          .toBe(true);
        const dimensions = await img.evaluate(async (i) => {
          await i.decode();
          return { width: i.naturalWidth, height: i.naturalHeight };
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        result.checks.push({
          surface: 'detail',
          id: a.shikimoriId,
          viewport: width,
          url: wanted,
          ...dimensions,
          ok: true,
        });
        if (a.shikimoriId === 1) {
          const related = page.locator('.related-list .related-poster').first();
          await related.scrollIntoViewIfNeeded();
          await expect(related).toHaveAttribute('src', /^https:\/\/shikimori.io\//);
          await expect
            .poll(() => related.evaluate((i) => i.naturalWidth), { timeout: 30000 })
            .toBeGreaterThan(0);
          await related.evaluate(async (i) => await i.decode());
          result.checks.push({ surface: 'related', viewport: width, ok: true });
        }
        if (staticIds.has(a.shikimoriId)) {
          await page.goto(new URL(`anime/${a.slug}/`, origin).href);
          const canonical = page.locator('.detail-poster');
          await canonical.scrollIntoViewIfNeeded();
          await expect(canonical).toHaveAttribute('src', wanted);
          await expect
            .poll(() => canonical.evaluate((i) => i.complete && i.naturalWidth > 0), {
              timeout: 30000,
            })
            .toBe(true);
          await canonical.evaluate(async (i) => await i.decode());
          result.checks.push({
            surface: 'static-detail',
            id: a.shikimoriId,
            viewport: width,
            ok: true,
          });
        }
      }
    }
    await page.locator('.detail-copy [data-favorite]').click();
    await page.goto(new URL('favorites/', origin).href);
    await expect(page.locator('#favorites-grid article')).toHaveCount(1);
    const favorite = page.locator('#favorites-grid img');
    await favorite.scrollIntoViewIfNeeded();
    await expect(favorite).toHaveAttribute('src', /^https:\/\/shikimori.io\//);
    await expect
      .poll(() => favorite.evaluate((i) => i.naturalWidth), { timeout: 30000 })
      .toBeGreaterThan(0);
    result.checks.push({ surface: 'favorites', ok: true });
    await page.goto(new URL('catalog/', origin).href);
    await expect(page.locator('#catalog-grid article')).toHaveCount(24);
    await page.locator('#catalog-search').fill(required[0].originalTitle);
    await page.locator('#catalog-search').fill(required[2].originalTitle);
    await expect(page.locator('#catalog-grid h3').first()).toHaveText(required[2].title);
    const card = page.locator('#catalog-grid article').first().locator('img');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('src', images[59193].poster);
    await expect
      .poll(() => card.evaluate((i) => i.naturalWidth), { timeout: 30000 })
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Открыть поиск' }).click();
    await page.getByRole('combobox').fill(required[0].originalTitle);
    const search = page
      .getByRole('option')
      .filter({ has: page.getByText(required[0].title, { exact: true }) })
      .first();
    await expect(search).toBeVisible();
    await expect(search.locator('img')).toHaveAttribute('src', images[1].poster);
    result.checks.push({ surface: 'catalog-and-query-change-and-search', ok: true });
    await page.goto(new URL('anime/?id=1', origin).href);
    await page.reload();
    await expect(page.locator('.detail-poster')).toHaveAttribute('src', images[1].posterDetailUrl);
    result.checks.push({ surface: 'reload', ok: true });
    await context.close();
    const failed = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      failurePage = await failed.newPage();
    let failures = 0;
    await failed.route('https://shikimori.io/**', (r) => {
      failures++;
      return r.abort('failed');
    });
    await failurePage.goto(new URL('anime/?id=1', origin).href);
    const fallback = failurePage.locator('.detail-poster');
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback).toHaveAttribute('src', /poster-placeholder.svg$/);
    await expect.poll(() => fallback.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
    expect(failures).toBeLessThan(10);
    result.checks.push({ surface: 'cdn-failure', requests: failures, ok: true });
    await failed.close();
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = String(error).split('\n')[0];
  } finally {
    await browser?.close();
  }
}
report.ok = report.browsers.every((r) => r.ok) && !report.apiRequests.length;
await writeFile('docs/research/poster-surfaces-0.3.3.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
