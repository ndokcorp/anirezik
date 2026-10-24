import { test, expect } from '@playwright/test';
import {
  resolveCatalogImages,
  localPosterExperiment,
  sourceApproved,
  type PosterSource,
} from '../src/lib/image-policy';
const a = {
  shikimoriId: 3929,
  sourcePosterMainUrl: 'https://shikimori.io/uploads/poster/main-hash.webp',
  sourcePosterUrl: 'https://shikimori.io/uploads/poster/original-hash.jpg',
};
const permission: PosterSource = {
  status: 'permission-granted',
  allowedOrigins: ['https://shikimori.io'],
  attribution: 'Shikimori / owner',
  evidence: 'Written permission fixture, not actual permission',
  hotlinking: true,
  browserCaching: true,
  scope: { kind: 'all' },
};
test('постеры: production и CI не включают локальный эксперимент', () => {
  expect(localPosterExperiment(true, '1')).toBe(true);
  for (const args of [
    [false, '1', false],
    [true, '1', true],
    [true, '0', false],
  ] as const)
    expect(localPosterExperiment(args[0], args[1], args[2])).toBe(false);
  expect(resolveCatalogImages(a).posterUrl).toBeNull();
  expect(resolveCatalogImages(a, true).imageLicenseStatus).toBe('local-experiment');
  expect(resolveCatalogImages(a, true).poster).toBe(a.sourcePosterMainUrl);
  expect(resolveCatalogImages(a, true).posterDetailUrl).toBe(a.sourcePosterUrl);
});
test('постеры: разрешение ограничено ID или точным URL и сроком', () => {
  expect(
    resolveCatalogImages(a, false, { ...permission, scope: { kind: 'ids', animeIds: [1] } })
      .posterUrl,
  ).toBeNull();
  expect(
    resolveCatalogImages(a, false, { ...permission, scope: { kind: 'ids', animeIds: [3929] } })
      .posterUrl,
  ).toBe(a.sourcePosterMainUrl);
  const specific = { ...permission, scope: { kind: 'urls', urls: [a.sourcePosterMainUrl] } };
  expect(resolveCatalogImages(a, false, specific).posterDetailUrl).toBe(a.sourcePosterMainUrl);
  expect(
    resolveCatalogImages(
      { ...a, sourcePosterMainUrl: a.sourcePosterMainUrl + '?changed' },
      false,
      specific,
    ).posterUrl,
  ).toBeNull();
  for (const expiresAt of ['2020-01-01', 'invalid'])
    expect(resolveCatalogImages(a, false, { ...permission, expiresAt }).posterUrl).toBeNull();
  expect(
    resolveCatalogImages(a, false, { ...permission, scope: { kind: 'none' } }).posterUrl,
  ).toBeNull();
});
test('постеры: подтверждение всего источника автоматически включает точные API URL', () => {
  const result = resolveCatalogImages(a, false, permission);
  expect(result.poster).toBe(a.sourcePosterMainUrl);
  expect(result.posterDetailUrl).toBe(a.sourcePosterUrl);
  expect(result.imageLicenseStatus).toBe('permission-granted');
  for (const override of [
    { evidence: '' },
    { hotlinking: null },
    { browserCaching: false },
    { attribution: '' },
    { status: 'unknown' },
  ]) {
    const source = { ...permission, ...override };
    expect(sourceApproved(source)).toBe(false);
    expect(resolveCatalogImages(a, false, source).posterUrl).toBeNull();
  }
});
test('постеры: неизвестные origins, HTTP и credentials не включаются даже в эксперименте', () => {
  for (const value of [
    'http://shikimori.io/x',
    'https://shikimori.io.evil.invalid/x',
    'https://user:pass@shikimori.io/x',
    'javascript:alert(1)',
  ]) {
    expect(
      resolveCatalogImages({ ...a, sourcePosterMainUrl: value, sourcePosterUrl: value }, true)
        .posterUrl,
    ).toBeNull();
  }
});
