import { test, expect } from '@playwright/test';
import { formatPlayerTime, seekTarget } from '../src/lib/player-controls';
test('AniRize formats hours and clamps ten second seeking', () => {
  expect(formatPlayerTime(3995)).toBe('1:06:35');
  expect(formatPlayerTime(6395)).toBe('1:46:35');
  expect(formatPlayerTime(4)).toBe('0:04');
  expect(formatPlayerTime(NaN)).toBe('0:00');
  expect(formatPlayerTime(-1)).toBe('0:00');
  expect(seekTarget(4, 100, -10)).toBe(0);
  expect(seekTarget(95, 100, 10)).toBe(100);
  expect(seekTarget(4, NaN, 10)).toBeNull();
});
