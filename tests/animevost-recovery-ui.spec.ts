import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Route } from '@playwright/test';
import solo from '../public/data/video/animego/52299.json' with { type: 'json' };
// Fault injection only. CC BY 3.0 Sintel trailer, Blender Foundation:
// https://durian.blender.org/sharing/ . Never published as an anime source.
const fixture = () => readFileSync('.cache/animevost-053/sintel-fixture.mp4');
async function clip(route: Route) {
  const data = fixture();
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
  await route.fulfill({
    status: range ? 206 : 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
    },
    body: data.subarray(start, end + 1),
  });
}
const playlist = (hd: string) =>
  [1, 2].map((n) => ({
    name: `${n} серия`,
    std: 'https://video.animetop.info/test-sd.mp4',
    hd: `https://video.animetop.info/${hd}.mp4`,
  }));
test.beforeEach(async ({ context }) => {
  await context.route('https://anilibria.top/api/v1/**', (route) => route.fulfill({ json: [] }));
  await context.route('**/data/video/animego/*.json', (route) => route.fulfill({ status: 404 }));
  await context.route('https://video.animetop.info/**', clip);
});

test('expired quality URL: fresh playlist, same episode/quality, preserved seek position', async ({
  page,
}) => {
  let calls = 0;
  await page.route('https://api.animevost.org/v1/playlist', (route) =>
    route.fulfill({ json: playlist(++calls === 1 ? 'test-expired' : 'test-fresh') }),
  );
  await page.route('https://video.animetop.info/test-expired.mp4', (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto('anime/54744/');
  await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
  const media = page.locator('video');
  await expect
    .poll(() => media.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(2);
  const before = await media.evaluate((v) => (v as HTMLVideoElement).currentTime);
  await page.getByRole('group', { name: 'Плеер AniRezik', exact: true }).press('ArrowRight');
  await expect
    .poll(() => media.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(before + 9);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  const position = await media.evaluate((v) => (v as HTMLVideoElement).currentTime);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Качество', exact: true }).click();
  await page.getByRole('option', { name: 'HD', exact: true }).click();
  await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(media).toHaveAttribute('src', 'https://video.animetop.info/test-fresh.mp4');
  // Engines can require a renewed gesture after async refresh; do not refetch.
  if (await page.getByRole('button', { name: 'Повторить', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect
    .poll(() => media.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(position + 1);
  await expect
    .poll(() => media.evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  expect(calls).toBe(2);
  await expect(page.getByRole('button', { name: 'Выбрать серию 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('anirezik:playback-providers:v1') || '{}')[
            'shikimori:54744|animevost'
          ]?.time ?? -1,
      ),
    )
    .toBeGreaterThanOrEqual(position - 0.5);
  await page.reload();
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('anirezik:playback-providers:v1') || '{}')[
        'shikimori:54744|animevost'
      ],
  );
  expect(stored?.time, JSON.stringify(stored)).toBeGreaterThanOrEqual(position - 0.5);
  const resume = page.getByRole('button', { name: /Продолжить с/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect
    .poll(() => media.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThanOrEqual(position - 0.5);
  expect(calls).toBe(3); // One deliberate reload, not an automatic retry loop.
});

test('denied refresh: no retry loop; fallback keeps episode 2 despite another provider saved on 3', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/data/video/animego/52299.json', (route) => route.fulfill({ json: solo }));
  await page.route('https://animego.me/cdn-iframe/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Isolated iframe fixture</p>' }),
  );
  await page.route('https://api.animevost.org/v1/playlist', (route) =>
    ++calls === 1
      ? route.fulfill({ json: playlist('test-expired') })
      : route.fulfill({ status: 403 }),
  );
  await page.route('https://video.animetop.info/test-*.mp4', (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      'anirezik:playback-providers:v1',
      JSON.stringify({
        'shikimori:52299|animego-cvh': {
          animeId: 'shikimori:52299',
          providerId: 'animego-cvh',
          releaseId: '52299',
          episodeNumber: 3,
          audio: 'ru|Amber',
          time: 100,
          duration: 1200,
          updatedAt: new Date().toISOString(),
          selectionConfirmed: true,
        },
      }),
    );
  });
  await page.goto('anime/52299/');
  await page.getByRole('button', { name: 'Плеер', exact: true }).click();
  await page.getByRole('option', { name: /^AnimeVost/ }).click();
  await page.getByRole('button', { name: 'Выбрать серию 2', exact: true }).click();
  await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
  const backup = page.getByRole('button', { name: 'Выбрать CVH · AnimeGO · серия 2', exact: true });
  await expect(backup).toBeVisible();
  expect(calls).toBe(2);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.player-status')).toContainText('30 секунд');
  expect(calls).toBe(2);
  await backup.click();
  await expect(page.getByRole('button', { name: 'Выбрать серию 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    solo.entries.find((e) => e.episodeNumber === 2)!.embedUrl,
  );
});
