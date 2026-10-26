import { test, expect } from '@playwright/test';
import config from '../src/data/kodik-catalog-config.json' with { type: 'json' };
import { queueState, runKodikQueue, type KodikQueueState } from '../scripts/lib/kodik-queue';
import type { CatalogAnime } from '../scripts/lib/kodik-catalog';

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ shikimoriId: i + 1 }) as CatalogAnime);
const now = Date.parse('2026-10-26T08:00:00Z');
test('0.4.7: queue exceeds ten IDs, deduplicates and respects the configured interval', async () => {
  let clock = now;
  const calls: number[] = [],
    times: number[] = [];
  const state = queueState(undefined, 'test', clock);
  const result = await runKodikQueue({
    anime: [...rows(25), ...rows(4)],
    config: { ...config, maxRequestsPerRun: 25, maxRequestsPerDay: 25 },
    state,
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    fresh: async () => false,
    query: async (a) => {
      calls.push(a.shikimoriId);
      times.push(clock);
    },
    checkpoint: async () => {},
  });
  expect(result.requests).toBe(25);
  expect(result.stopped).toBe('complete-pass');
  expect(new Set(calls).size).toBe(25);
  for (let i = 1; i < times.length; i++)
    expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(config.minRequestIntervalMs);
});

test('0.4.7: failed ID is retried after restart, completed IDs stay cached and quota survives errors/revisions', async () => {
  let clock = now;
  let saved: KodikQueueState = queueState(undefined, 'test', clock);
  const fresh = new Set<number>(),
    calls: number[] = [];
  const common = {
    anime: rows(5),
    config: { ...config, maxRequestsPerRun: 3, maxRequestsPerDay: 6 },
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
    },
    fresh: async (a: CatalogAnime) => fresh.has(a.shikimoriId),
    checkpoint: async (s: KodikQueueState) => {
      saved = structuredClone(s);
    },
  };
  await expect(
    runKodikQueue({
      ...common,
      state: saved,
      query: async (a) => {
        calls.push(a.shikimoriId);
        if (a.shikimoriId === 3) throw new Error('Test interruption');
        fresh.add(a.shikimoriId);
      },
    }),
  ).rejects.toThrow('Test interruption');
  expect(saved.nextId).toBe(3);
  expect(saved.requestsToday).toBe(3);
  const resumed = queueState(saved, 'test', clock);
  const result = await runKodikQueue({
    ...common,
    state: resumed,
    query: async (a) => {
      calls.push(a.shikimoriId);
      fresh.add(a.shikimoriId);
    },
  });
  expect(calls).toEqual([1, 2, 3, 3, 4, 5]);
  expect(result.fresh).toBe(2);
  expect(resumed.requestsToday).toBe(6);
  expect(queueState(resumed, 'revised', clock).requestsToday).toBe(6);
  expect(queueState(resumed, 'test', clock + 86400000).requestsToday).toBe(0);
  expect(() => queueState({ schemaVersion: 1 }, 'test', clock)).toThrow('invalid-queue-checkpoint');
});

test('0.4.7: per-run and daily quotas stop safely and continue at the next ID', async () => {
  let clock = now;
  const state = queueState(undefined, 'test', clock),
    fresh = new Set<number>();
  const options = {
    anime: rows(10),
    config: { ...config, maxRequestsPerRun: 2, maxRequestsPerDay: 3 },
    state,
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
    },
    fresh: async (a: CatalogAnime) => fresh.has(a.shikimoriId),
    query: async (a: CatalogAnime) => {
      fresh.add(a.shikimoriId);
    },
    checkpoint: async () => {},
  };
  expect((await runKodikQueue(options)).stopped).toBe('batch-budget');
  expect(state.nextId).toBe(3);
  expect((await runKodikQueue(options)).stopped).toBe('daily-budget');
  expect(state.nextId).toBe(4);
  expect(state.requestsToday).toBe(3);
  const empty = await runKodikQueue({ ...options, anime: [] });
  expect(empty.requests).toBe(0);
});
