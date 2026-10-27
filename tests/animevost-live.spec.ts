import { test, expect } from '@playwright/test';
// Explicit opt-in; never run remote-video checks in the ordinary offline suite.
test.skip(process.env.ANIMEVOST_LIVE !== '1', 'Authorized remote pilot only');
test('AnimeVost: real playback and controls in existing Player', async ({ page }, testInfo) => {
  await page.goto('anime/54744/');
  await page.getByRole('link', { name: 'СМОТРЕТЬ', exact: true }).click();
  const play = page.getByRole('button', { name: 'Воспроизвести видео', exact: true });
  await expect(play).toBeVisible({ timeout: 25_000 });
  await play.click();
  const video = page.locator('video');
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 30_000 })
    .toBeGreaterThan(2);
  expect(await video.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  const before = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
  await page.getByRole('slider', { name: 'Позиция видео' }).press('ArrowRight');
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(before + 0.5);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Качество', exact: true }).click();
  await page.getByRole('option', { name: 'HD', exact: true }).click();
  // A paused video need not decode a frame after changing src. Resume through
  // the real UI before asserting the decoded dimensions.
  await play.click();
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).videoHeight), { timeout: 25_000 })
    .toBeGreaterThan(0);
  expect(await video.evaluate((v) => (v as HTMLVideoElement).videoHeight)).toBeGreaterThanOrEqual(
    720,
  );
  await page.getByRole('button', { name: 'Выбрать серию 2', exact: true }).click();
  await play.click();
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 30_000 })
    .toBeGreaterThan(2);
  await expect(page.getByRole('button', { name: 'Выбрать серию 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const result = await video.evaluate((v) => {
    const media = v as HTMLVideoElement;
    return {
      currentTime: media.currentTime,
      duration: media.duration,
      width: media.videoWidth,
      height: media.videoHeight,
      readyState: media.readyState,
    };
  });
  await testInfo.attach('playback-observation', {
    body: JSON.stringify({ browser: testInfo.project.name, id: 54744, episode: 2, ...result }),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
});
