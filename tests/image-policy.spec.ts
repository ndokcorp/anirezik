import { test, expect } from '@playwright/test';
import sources from '../src/data/image-sources.json' with { type: 'json' };
import rights from '../src/data/image-rights.json' with { type: 'json' };
import { ratingValue } from '../src/lib/rating';
import { ageLabel, episodeLabel } from '../src/lib/card-meta';
import { descriptions } from '../src/lib/descriptions';
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
test('карточки и описания: фактический возраст/эпизоды; отдельные разрешённые тексты', () => {
  expect(ageLabel('PG-13')).toBe('PG-13');
  for (const value of [null, undefined, 'NONE', 'invented']) expect(ageLabel(value)).toBeNull();
  expect(episodeLabel('TV', 12)).toBe('12 эп.');
  expect(episodeLabel('Фильм', null)).toBe('Фильм');
  for (const value of [null, 0, -1]) expect(episodeLabel('TV', value)).toBeNull();
  expect(descriptions.size).toBe(23);
  expect(descriptions.get(1)?.language).toBe('en');
  expect(descriptions.get(52299)?.language).toBe('ru');
  expect(descriptions.has(59193)).toBe(false);
});
test('рейтинг: настоящая оценка с одним десятичным знаком; null, 0 и нечисловые значения скрыты', () => {
  expect(ratingValue(8.74)).toBe('8.7');
  expect(ratingValue(10)).toBe('10.0');
  for (const score of [null, undefined, 0, -1, NaN, Infinity, 11])
    expect(ratingValue(score)).toBeNull();
});
test('постеры: production и CI не включают локальный эксперимент', () => {
  expect(localPosterExperiment(true, '1')).toBe(true);
  for (const args of [
    [false, '1', false],
    [true, '1', true],
    [true, '0', false],
  ] as const)
    expect(localPosterExperiment(args[0], args[1], args[2])).toBe(false);
  expect(resolveCatalogImages(a).posterUrl).toBe(a.sourcePosterMainUrl);
  expect(resolveCatalogImages(a, false, { ...permission, status: 'unknown' }).posterUrl).toBeNull();
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

test('TVmaze: только проверенные пары URL; отзыв разрешения возвращает нейтральную заглушку', () => {
  const entries = Object.entries(rights).filter(([, item]) => 'remotePoster' in item);
  expect(entries).toHaveLength(20);
  for (const [id, item] of entries) {
    const record = item as import('../src/lib/images').ImagePermission;
    const remote = record.remotePoster!;
    const result = resolveCatalogImages({ shikimoriId: Number(id) });
    expect(result.imageSource).toBe('TVmaze');
    expect(result.poster).toBe(remote.posterUrl);
    expect(result.posterDetailUrl).toBe(remote.posterDetailUrl);
    expect(sources.tvmaze.scope.urls).toEqual(
      expect.arrayContaining([remote.posterUrl, remote.posterDetailUrl]),
    );
    expect(new URL(result.poster).origin).toBe('https://static.tvmaze.com');
    for (const override of [
      { status: 'unknown' },
      { evidence: '' },
      { hotlinking: false },
      { scope: { kind: 'urls', urls: [] } },
    ]) {
      const blocked = resolveCatalogImages({ shikimoriId: Number(id) }, false, sources.shikimori, {
        ...sources.tvmaze,
        ...override,
      });
      expect(blocked.posterUrl).toBeNull();
      expect(blocked.imageSource).not.toBe('TVmaze');
    }
  }
  expect(resolveCatalogImages({ shikimoriId: 5 }).posterUrl).toBeNull();
  expect(resolveCatalogImages({ shikimoriId: 59193 }).posterUrl).toBeNull();
});

test('согласие по URL: Shikimori основной, TVmaze резерв; HTTP-кеш не является разрешением на хранение', () => {
  expect(sources.shikimori.browserCaching).toBeNull();
  expect(sourceApproved(sources.shikimori)).toBe(true);
  expect(sourceApproved({ ...sources.shikimori, browserCachePolicy: undefined })).toBe(false);
  expect(sourceApproved({ ...sources.shikimori, browserCaching: false })).toBe(false);
  const a = {
    shikimoriId: 1,
    sourcePosterMainUrl: 'https://shikimori.io/uploads/poster/animes/1/main.webp',
    sourcePosterUrl: 'https://shikimori.io/uploads/poster/animes/1/original.jpeg',
  };
  expect(resolveCatalogImages(a).imageSource).toBe('Shikimori');
  expect(resolveCatalogImages(a).posterDetailUrl).toBe(a.sourcePosterUrl);
  expect(resolveCatalogImages({ shikimoriId: 1 }).imageSource).toBe('TVmaze');
  expect(resolveCatalogImages({ shikimoriId: 199 }).posterUrl).toBeNull();
});
