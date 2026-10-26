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
    const transport: { origin: string; status?: number; error?: string }[] = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.hostname.endsWith('.libria.fun'))
        transport.push({ origin: u.origin, status: r.status() });
    });
    page.on('requestfailed', (r) => {
      const u = new URL(r.url());
      if (u.hostname.endsWith('.libria.fun'))
        transport.push({ origin: u.origin, error: r.failure()?.errorText });
    });
    try {
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith(`/anime/releases/${release}`),
        { timeout: 20000 },
      );
      await page.goto(process.env.ANILIBERTY_LIVE_DEV === '1' ? `anime/?id=${id}` : `anime/${id}/`);
      await page.locator('#anime-player').scrollIntoViewIfNeeded();
      const player = page.locator('[data-player]');
      const http = await response;
      expect(http.status()).toBe(200);
      const raw = await http.json();
      const row = raw.data || raw;
      const origins = [
        ...new Set(
          (row.episodes || []).flatMap((ep: Record<string, unknown>) =>
            ['hls_480', 'hls_720', 'hls_1080'].flatMap((key) => {
              try {
                return typeof ep[key] === 'string' && ep[key]
                  ? [new URL(ep[key] as string).origin]
                  : [];
              } catch {
                return [];
              }
            }),
          ),
        ),
      ];
      await writeFile(
        info.outputPath('availability.json'),
        JSON.stringify({
          shikimoriId: id,
          releaseId: row.id,
          externalId: row.shikimori?.id,
          episodeCount: row.episodes?.length,
          geo: row.is_blocked_by_geo,
          copyright: row.is_blocked_by_copyrights,
          origins,
        }),
      );
      expect(Number(row.shikimori.id)).toBe(id);
      expect(row.is_blocked_by_geo).toBe(false);
      expect(row.is_blocked_by_copyrights).toBe(false);
      const video = player.locator('video');
      await video.waitFor({ timeout: 15000 });
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
    } finally {
      await writeFile(
        info.outputPath('transport.json'),
        JSON.stringify({
          shikimoriId: id,
          browser: browserName,
          responses: transport,
          notice: await page.locator('.player-status').allTextContents(),
          media: await page
            .locator('video')
            .evaluateAll((v: HTMLVideoElement[]) =>
              v.map((x) => ({ error: x.error?.code, ready: x.readyState, time: x.currentTime })),
            ),
        }),
      );
    }
  });
