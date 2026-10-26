import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import index from '../src/data/aniliberty-index.json' with { type: 'json' };
const samples = [
  [1, 8443, 'old TV'],
  [53397, 9489, 'new TV'],
  [64505, 10354, 'ongoing'],
  [52991, 9542, 'completed TV'],
  [32281, 6826, 'movie'],
  [30458, 1531, 'OVA'],
  [32827, 6011, 'ONA'],
] as const;
test.describe.configure({ mode: 'serial' });
for (const [id, release, category] of samples)
  test(`real video ${id} ${category}`, async ({ page, browserName }, info) => {
    test.skip(process.env.ANILIBERTY_LIVE !== '1', 'Explicit live verification only');
    test.setTimeout(55000);
    expect((index.mappings as Record<string, { releaseId: number }>)[id].releaseId).toBe(release);
    const response = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith(`/anime/releases/${release}`),
    );
    await page.goto(`anime/${id}/`);
    await page.locator('#anime-player').scrollIntoViewIfNeeded();
    const player = page.locator('[data-player]');
    await player.scrollIntoViewIfNeeded();
    const raw = await (await response).json();
    const row = raw.data || raw;
    expect(Number(row.shikimori.id)).toBe(id);
    expect(row.is_blocked_by_geo).toBe(false);
    expect(row.is_blocked_by_copyrights).toBe(false);
    const video = player.locator('video');
    await video.waitFor();
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
    });
    await player.locator('.player-big-play').click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30000 })
      .toBeGreaterThan(1);
    const proof = await video.evaluate(async (v: HTMLVideoElement) => {
      let decoded = 0;
      if (typeof v.requestVideoFrameCallback === 'function')
        await Promise.race([
          new Promise<void>((resolve) =>
            v.requestVideoFrameCallback(() => {
              decoded++;
              resolve();
            }),
          ),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      return {
        time: v.currentTime,
        width: v.videoWidth,
        height: v.videoHeight,
        paused: v.paused,
        decodedFrames: Math.max(decoded, v.getVideoPlaybackQuality?.().totalVideoFrames || 0),
      };
    });
    expect(proof.width).toBeGreaterThan(0);
    expect(proof.height).toBeGreaterThan(0);
    expect(proof.decodedFrames).toBeGreaterThan(0);
    expect(proof.paused).toBe(false);
    const selected = await player.locator('[aria-pressed="true"]').allTextContents();
    expect(selected.length).toBeGreaterThan(0);
    expect(
      row.episodes.some((e: { ordinal: number }) => selected.includes(String(e.ordinal))),
    ).toBe(true);
    await writeFile(
      info.outputPath('playback.json'),
      JSON.stringify({
        shikimoriId: id,
        releaseId: release,
        category,
        browser: browserName,
        viewport: page.viewportSize(),
        ...proof,
        selected,
        geoBlocked: false,
        copyrightBlocked: false,
      }),
    );
    await video.evaluate((v: HTMLVideoElement) => v.pause());
  });
