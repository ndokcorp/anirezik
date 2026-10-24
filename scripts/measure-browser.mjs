// Manual production benchmark; no external API or external image probes.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.ANIREZIK_TEST_URL || 'http://127.0.0.1:4323/';
const results = { checkedAt: new Date().toISOString(), origin, scenarios: [] };
function workingSet(pid) {
  if (process.platform !== 'win32') return null;
  const script = `$aniProcesses=Get-CimInstance Win32_Process; $aniIds=[System.Collections.Generic.HashSet[int]]::new(); [void]$aniIds.Add(${pid}); do { $aniAdded=0; foreach($aniProcess in $aniProcesses){if($aniIds.Contains([int]$aniProcess.ParentProcessId) -and $aniIds.Add([int]$aniProcess.ProcessId)){$aniAdded++}} } while($aniAdded -gt 0); $aniTotal=0; foreach($aniId in $aniIds){$aniMemory=Get-Process -Id $aniId -ErrorAction SilentlyContinue; if($aniMemory){$aniTotal+=$aniMemory.WorkingSet64}}; $aniTotal`;
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim(),
  );
}
for (const slow of [false, true]) {
  const server = await chromium.launchServer({ args: ['--enable-precise-memory-info'] });
  const browser = await chromium.connect(server.wsEndpoint());
  try {
    const context = await browser.newContext({
      viewport: slow ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: slow,
    });
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (slow) {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 400,
        downloadThroughput: 50000,
        uploadThroughput: 20000,
        connectionType: 'cellular3g',
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    let bytes = 0;
    const requests = [];
    cdp.on('Network.loadingFinished', (event) => (bytes += event.encodedDataLength));
    context.on('request', (request) => requests.push(request.url()));
    await page.addInitScript(() => {
      globalThis.aniLcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) globalThis.aniLcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const start = Date.now();
    await page.goto(origin, { waitUntil: 'load', timeout: 90000 });
    await page.locator('#global-search').waitFor({ state: 'attached' });
    const homeLoadMs = Date.now() - start;
    const home = await page.evaluate(() => ({
      fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      lcpMs: globalThis.aniLcp,
      domNodes: document.querySelectorAll('*').length,
      cards: document.querySelectorAll('.anime-card').length,
      images: document.images.length,
      mainJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    }));
    const initialBytes = bytes,
      initialRequests = [...requests];
    const beforeSearchWorkingSetBytes = workingSet(server.process().pid);
    const input = page.getByRole('combobox', { name: 'Поиск аниме' });
    if (slow) await page.getByRole('button', { name: 'Открыть поиск' }).click();
    const coldStart = Date.now();
    await input.fill('Solo Leveling');
    await page.locator('#search-results [role=option]').first().waitFor({ timeout: 120000 });
    const coldSearchMs = Date.now() - coldStart;
    const warmedSearches = [];
    for (const query of [
      'Naruto',
      'Log Horizon',
      'Paradise Kiss',
      'Ore Monogatari!!',
      'Macross',
      'Violet Evergarden',
      'Fullmetal Alchemist',
      'Solo Leveling',
    ]) {
      const t = Date.now();
      await input.fill(query);
      await page.waitForFunction(
        () => document.querySelector('#global-search')?.getAttribute('aria-busy') !== 'true',
      );
      warmedSearches.push(Date.now() - t);
    }
    const afterSearchWorkingSetBytes = workingSet(server.process().pid);
    const scroll = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const gaps = [];
          let previous = performance.now(),
            frames = 0;
          function frame(now) {
            gaps.push(now - previous);
            previous = now;
            scrollBy(0, 12);
            if (++frames < 90) requestAnimationFrame(frame);
            else
              resolve({
                frames,
                meanFrameMs: gaps.reduce((a, b) => a + b, 0) / gaps.length,
                framesOver50Ms: gaps.filter((gap) => gap > 50).length,
              });
          }
          requestAnimationFrame(frame);
        }),
    );
    results.scenarios.push({
      mode: slow ? 'mobile-slow3g-cpu4' : 'desktop-local',
      network: slow
        ? { latencyMs: 400, bytesPerSecond: 50000, cpuRate: 4 }
        : 'unthrottled localhost',
      homeLoadMs,
      home,
      initialBytes,
      initialRequests: initialRequests.length,
      initialIndexRequests: initialRequests.filter((url) => url.includes('search-index.')).length,
      initialDetailRequests: initialRequests.filter((url) => url.includes('/data/anime/')).length,
      initialImageRequests: initialRequests.filter((url) => /\.(webp|png|svg)(\?|$)/.test(url))
        .length,
      coldSearchMs,
      warmedSearchesMs: warmedSearches,
      beforeSearchWorkingSetBytes,
      afterSearchWorkingSetBytes,
      memoryNote:
        'Sum of working sets of this Chrome process tree; shared pages may be counted more than once. Main JS heap excludes the worker.',
      scroll,
    });
    console.log(JSON.stringify(results.scenarios.at(-1)));
  } finally {
    await browser.close();
    await server.close();
  }
}
await mkdir('docs/research', { recursive: true });
await writeFile('docs/research/performance-0.3.0.json', JSON.stringify(results, null, 2) + '\n');
