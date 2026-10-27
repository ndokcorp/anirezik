import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type { SyncCandidate } from '../scripts/lib/global-auto-sync';
import rights from '../src/data/video-rights.json' with { type: 'json' };
test.skip(process.env.AUTO_SYNC_LIVE !== '1', 'Explicit bounded approved source gate');
const plan = (() => {
  try {
    return JSON.parse(readFileSync('.cache/global-auto-sync/plan.json', 'utf8'));
  } catch {
    return { selected: [] };
  }
})();
let stop = false;
const records: any[] = [];
test.describe.configure({ mode: 'serial' });
for (const c of plan.selected as SyncCandidate[])
  test(`auto-sync actual Player ${c.provider} ${c.id}`, async ({ page }) => {
    if (stop) {
      test.skip(true, 'Provider access restriction: batch stopped');
      return;
    }
    test.setTimeout(100000);
    page.on('response', (r) => {
      if (
        ([401, 403, 429].includes(r.status()) ||
          /text\/html/i.test(r.headers()['content-type'] || '')) &&
        [
          'https://api.animevost.org',
          'https://video.animetop.info',
          'https://anilibria.top',
          ...rights.allowedPlaybackOrigins,
        ].includes(new URL(r.url()).origin)
      )
        stop = true;
    });
    const result: any = {
      provider: c.provider,
      id: c.id,
      releaseId: c.releaseId,
      passed: false,
      episodes: [],
    };
    try {
      // Budget isolation only: do not query an unselected provider. Candidate
      // API/media responses stay real; no video response is intercepted.
      await page.route(
        c.provider === 'animevost'
          ? 'https://anilibria.top/api/**'
          : 'https://api.animevost.org/**',
        (route) => route.abort(),
      );
      await page.goto(`anime/${c.id}/`);
      await page.getByRole('link', { name: 'СМОТРЕТЬ', exact: true }).click();
      await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true', {
        timeout: 30000,
      });
      const select = page.getByRole('button', { name: 'Плеер', exact: true });
      if (await select.count()) {
        await select.click();
        await page
          .getByRole('option', {
            name: c.provider === 'animevost' ? /^AnimeVost \(/ : /^AniRezik \(/,
          })
          .click();
      }
      await expect(page.locator('[data-video-provider]')).toHaveValue(c.provider);
      const numbers = [...new Set([c.episodeNumbers[0], c.episodeNumbers.at(-1)!])];
      for (const n of numbers) {
        await page.getByRole('button', { name: `Выбрать серию ${n}`, exact: true }).click();
        await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
        const video = page.locator('video');
        await expect
          .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), {
            timeout: 30000,
          })
          .toBeGreaterThan(3);
        const observation = await video.evaluate((v) => {
          const m = v as HTMLVideoElement;
          return {
            time: m.currentTime,
            width: m.videoWidth,
            height: m.videoHeight,
            duration: m.duration,
          };
        });
        expect(observation.width).toBeGreaterThan(0);
        result.episodes.push({ episode: n, ...observation });
        await page.getByRole('group', { name: 'Плеер AniRezik', exact: true }).press('ArrowRight');
        await expect
          .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
          .toBeGreaterThan(Math.min(observation.time + 9, observation.duration - 1));
        await page.getByRole('button', { name: 'Пауза', exact: true }).click();
      }
      result.passed = true;
    } catch (e) {
      result.reason = stop
        ? 'provider-access-restriction'
        : e instanceof Error
          ? e.message
              .replace(/\u001b\[[\d;]*m/g, '')
              .split('\n')[0]
              .replace(/https?:\/\/\S+/g, '[URL]')
              .slice(0, 200)
          : 'video-failure';
    } finally {
      records.push(result);
      writeFileSync(
        '.cache/global-auto-sync/video-results.json',
        JSON.stringify({ records }, null, 2),
      );
    }
    // A failed candidate is quarantined; other independent matches can publish.
  });
