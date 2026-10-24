// Manual diagnostic only: four small live requests, no API calls in the site or normal tests.
import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const report = {
  checkedAt: new Date().toISOString(),
  originPage: 'https://pages-themes.github.io/minimal/',
  engines: [],
};
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const wire = [];
    page.on('request', async (request) => {
      if (request.url().includes('shikimori.io/api/graphql'))
        wire.push({ method: request.method(), headers: await request.allHeaders() });
    });
    await page.goto(report.originPage, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = {
      name,
      page: page.url(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      wire,
      attempts: [],
    };
    for (const customUA of [false, true]) {
      result.attempts.push(
        await page.evaluate(async (customUA) => {
          try {
            const response = await fetch('https://shikimori.io/api/graphql', {
              method: 'POST',
              mode: 'cors',
              credentials: 'omit',
              headers: {
                'Content-Type': 'application/json',
                ...(customUA ? { 'User-Agent': 'AniRezik/0.2.2 (browser diagnostic)' } : {}),
              },
              body: JSON.stringify({
                query:
                  'query { animes(search: "GTO", limit: 1, censored: true) { id name russian url } }',
              }),
              signal: AbortSignal.timeout(20000),
            });
            return {
              customUA,
              status: response.status,
              type: response.type,
              body: await response.json(),
            };
          } catch (error) {
            return { customUA, error: String(error) };
          }
        }, customUA),
      );
    }
    await context.setOffline(true);
    result.offline = await page.evaluate(async () => {
      try {
        await fetch('https://shikimori.io/api/graphql', { signal: AbortSignal.timeout(2000) });
        return 'unexpected success';
      } catch (error) {
        return String(error);
      }
    });
    report.engines.push(result);
  } catch (error) {
    report.engines.push({ name, error: String(error) });
  } finally {
    await browser.close();
  }
}
await mkdir('.cache', { recursive: true });
await writeFile('.cache/browser-api-022.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
