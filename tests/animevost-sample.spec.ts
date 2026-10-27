import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import index from '../src/data/animevost-index.json' with { type: 'json' };
const mappings: Record<string, { episodeNumbers: number[] }> = index.mappings;
const ids = [
  1, 43, 21, 269, 918, 52991, 58567, 16498, 63382, 63098, 1761, 28069, 21667, 18441, 37735,
];
let stop = false;
test.skip(process.env.ANIMEVOST_SAMPLE !== '1', 'Explicit bounded live audit only');
test.describe.configure({ mode: 'serial' });
for (const id of ids)
  test(`real AnimeVost sample ${id}`, async ({ page }) => {
    test.skip(stop, 'Supplier access/rate restriction: no further requests');
    test.setTimeout(90_000);
    const api: number[] = [],
      media: { origin: string; status: number; type: string }[] = [];
    const observations: object[] = [];
    page.on('response', (response) => {
      const u = new URL(response.url());
      if (u.origin === 'https://api.animevost.org') {
        api.push(response.status());
        if ([401, 403, 429].includes(response.status())) stop = true;
      }
      if (u.origin === 'https://video.animetop.info') {
        media.push({
          origin: u.origin,
          status: response.status(),
          type: response.headers()['content-type'] || '',
        });
        if (response.status() === 429) stop = true;
      }
    });
    let failure: string | null = null;
    try {
      await page.goto(`anime/${id}/`);
      await page.getByRole('link', { name: 'СМОТРЕТЬ', exact: true }).click();
      await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true', {
        timeout: 30_000,
      });
      const provider = page.getByRole('button', { name: 'Плеер', exact: true });
      if (await provider.count()) {
        await provider.click();
        await page.getByRole('option', { name: /^AnimeVost \(/ }).click();
      }
      const numbers = mappings[String(id)].episodeNumbers;
      const episodes = [numbers[0], ...([21, 63382].includes(id) ? [numbers.at(-1)!] : [])];
      for (const episode of [...new Set(episodes)]) {
        await page.getByRole('button', { name: `Выбрать серию ${episode}`, exact: true }).click();
        await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
        const video = page.locator('video');
        await expect
          .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), {
            timeout: 30_000,
          })
          .toBeGreaterThan(3);
        const observation = await video.evaluate((v) => {
          const m = v as HTMLVideoElement;
          return {
            time: m.currentTime,
            duration: m.duration,
            width: m.videoWidth,
            height: m.videoHeight,
            readyState: m.readyState,
          };
        });
        expect(observation.width).toBeGreaterThan(0);
        observations.push({ episode, ...observation });
        await page.getByRole('button', { name: 'Пауза', exact: true }).click();
      }
    } catch (error) {
      failure = error instanceof Error ? error.message.split('\n')[0] : 'test failure';
      throw error;
    } finally {
      mkdirSync('.cache/animevost-053/videos', { recursive: true });
      writeFileSync(
        `.cache/animevost-053/videos/${id}.json`,
        JSON.stringify({ id, api, media, observations, failure }, null, 2),
      );
    }
    await page.waitForTimeout(2000); // Sequential, bounded supplier requests.
  });
