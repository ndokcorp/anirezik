import { featuredAnime } from '../src/lib/featured-anime';
import { descriptions } from '../src/lib/descriptions';
import licensedDescriptions from '../src/data/licensed-descriptions.json' with { type: 'json' };
import { ageLabel } from '../src/lib/card-meta';
import { test, expect } from '@playwright/test';

// Reproducible regressions; real CDN decoding is checked separately on Pages.
test.beforeEach(async ({ context }) => {
  // Offline regression suite: no public API/stream calls. Live playback is checked separately.
  await context.route('https://anilibria.top/api/v1/**', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const ids: Record<number, number> = {
      9542: 52991,
      8674: 9253,
      9600: 52299,
      9839: 58567,
      6826: 32281,
      8789: 40748,
      9313: 48561,
      9470: 51009,
    };
    await route.fulfill({
      json: ids[id]
        ? {
            id,
            shikimori: { id: ids[id] },
            episodes: [],
            is_blocked_by_geo: false,
            is_blocked_by_copyrights: false,
          }
        : [],
    });
  });
  await context.route('https://static.tvmaze.com/uploads/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#800"/></svg>',
    }),
  );
  await context.route('https://shikimori.io/uploads/poster/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#800"/></svg>',
    }),
  );
});

test('0.3.6: карточки без подписи, возраст/эпизоды, hover и резерв размера', async ({ page }) => {
  const main = solo.posterUrl!;
  await page.route(main, (r) => r.abort());
  await page.goto('./');
  const card = page.locator('#popular [data-anime-id="shikimori:52299"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img')).toHaveAttribute('src', solo.posterDetailUrl!);
  await expect(card.locator('.art-label')).toHaveCount(0);
  await expect(card.locator('.card-age')).toHaveText(ageLabel(solo.ageRating)!);
  await expect(card.locator('.card-episodes')).toHaveText(`${solo.episodes} эп.`);
  await card.locator('.card-link').hover();
  await expect
    .poll(() => card.locator('.card-play').evaluate((x) => getComputedStyle(x).opacity))
    .toBe('1');
  await expect(card.locator('.card-play')).toContainText('Подробнее');
  await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.goto('catalog/?q=Solo%20Leveling');
  const dynamic = page.locator('#catalog-grid [data-anime-id="shikimori:52299"]');
  await expect(dynamic.locator('.card-age')).toHaveText(ageLabel(solo.ageRating)!);
  await expect(dynamic.locator('.card-episodes')).toHaveText(`${solo.episodes} эп.`);
  await expect(dynamic.locator('.art-label')).toHaveCount(0);
});

test('0.3.6: временный отказ пакета не оставляет постер навсегда заглушкой', async ({
  page,
  context,
}) => {
  let calls = 0;
  await context.route('**/data/images/0.json', (r) => (++calls === 1 ? r.abort() : r.continue()));
  await page.goto('catalog/?q=Cowboy%20Bebop');
  const img = page.locator('#catalog-grid [data-anime-id="shikimori:1"] img');
  await expect.poll(() => calls).toBe(1);
  await expect(img).toHaveAttribute('data-image-id', '1');
  await expect(img).toHaveAttribute('data-image-retried', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(img).toHaveAttribute('src', anime.find((a) => a.shikimoriId === 1)!.posterUrl!);
  expect(calls).toBe(2);
});

test('0.3.6: описания загружаются только для detail, с атрибуцией и безопасным fallback', async ({
  page,
  context,
}) => {
  await context.route('**/data/descriptions/1.json', (r) =>
    r.fulfill({ json: { id: 1, ...licensedDescriptions['1'] } }),
  );
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/data/descriptions/')) calls.push(r.url());
  });
  await page.goto('./');
  expect(calls).toEqual([]);
  await page.goto('anime/?id=1');
  await expect(page.locator('.description')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.description-credit')).toContainText('TVmaze');
  expect(calls.length).toBe(1);
  const detail = await (await page.request.get('data/anime/1.json')).json();
  expect(detail.hasDescription).toBe(true);
  expect(detail.description).toBeUndefined();
  await context.route('**/data/descriptions/1.json', (r) =>
    r.fulfill({
      json: {
        id: 1,
        text: '<img src=x onerror="window.injected=true">',
        attribution: 'TVmaze test fixture',
        sourceUrl: 'https://www.tvmaze.com/shows/1121/cowboy-bebop',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        language: 'en',
      },
    }),
  );
  await page.reload();
  await expect(page.locator('.description')).toHaveText(
    '<img src=x onerror="window.injected=true">',
  );
  await expect(page.locator('.description img')).toHaveCount(0);
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  await context.unroute('**/data/descriptions/1.json');
  await context.route('**/data/descriptions/1.json', (r) => r.abort());
  await page.reload();
  await expect(page.locator('.description')).toContainText('Описание пока недоступно');
});

test('production: реестр ограничивает Shikimori независимо от локального переключателя', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'shikimori.io') requests.push(r.url());
  });
  const config = await (await page.request.get('image-index.json')).json();
  const allowed = anime.filter(
    (a) =>
      a.imageSource === 'Shikimori' && a.imageLicenseStatus === 'permission-granted' && a.posterUrl,
  );
  expect(config.experimental).toBe(false);
  const tvmaze = anime.filter((a) => a.imageSource === 'TVmaze');
  expect(tvmaze).toHaveLength(0);
  for (const a of tvmaze) {
    expect(config.images[a.shikimoriId].poster).toBe(a.posterUrl);
    expect(config.images[a.shikimoriId].posterDetailUrl).toBe(a.posterDetailUrl);
  }
  expect(config.sharded).toBe(allowed.length > 0);
  expect([...config.buckets].sort((a, b) => a - b)).toEqual(
    [...new Set(allowed.map((a) => Math.floor(a.shikimoriId / 1000)))].sort((a, b) => a - b),
  );
  expect(
    Object.values(config.images).every(
      (a: any) =>
        a.imageLicenseStatus === 'original-ai' || a.imageLicenseStatus === 'permission-granted',
    ),
  ).toBe(true);
  // Reproducible suite uses our SVG if the real registry permits a remote source.
  // Actual CDN decoding is verified separately by test:posters:surfaces.
  await page.route('https://shikimori.io/uploads/poster/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#800"/></svg>',
    }),
  );
  await page.goto('anime/?id=3929');
  await expect(page.locator('.detail-poster')).toBeVisible();
  const a = anime.find((a) => a.shikimoriId === 3929)!;
  const expected = a.posterDetailUrl || a.poster;
  await expect(page.locator('.detail-poster')).toHaveAttribute(
    'src',
    /^https:/.test(expected)
      ? expected
      : new RegExp(`${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
  if (!allowed.length) expect(requests).toEqual([]);
  else {
    const allowedUrls = new Set(allowed.flatMap((a) => [a.posterUrl, a.posterDetailUrl]));
    expect(requests.every((u) => allowedUrls.has(u))).toBe(true);
  }
});

test('пакеты постеров: оригинал деталей, отказ URL и отсутствие API запросов', async ({
  page,
  context,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => calls.push(r.url()));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#a00"/></svg>';
  const images = {
    '3929': {
      poster: 'https://poster-fixtures.invalid/compact.webp',
      posterUrl: 'https://poster-fixtures.invalid/compact.webp',
      posterDetailUrl: 'https://poster-fixtures.invalid/original.jpg',
      backdropUrl: null,
      imageSource: 'Test fixture',
      imageAttribution: 'Test fixture only',
      imageLicenseStatus: 'permission-granted',
    },
  };
  await context.route('**/image-index.json', (route) =>
    route.fulfill({
      json: { version: 2, sharded: true, buckets: [3], experimental: false, images: {} },
    }),
  );
  await context.route('**/data/images/3.json', (route) => route.fulfill({ json: images }));
  await context.route('https://poster-fixtures.invalid/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await page.goto('anime/?id=3929');
  const poster = page.locator('.detail-poster');
  await expect(poster).toHaveAttribute('src', images['3929'].posterDetailUrl);
  await expect
    .poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(poster).toHaveAttribute('src', images['3929'].posterDetailUrl);
  expect(
    await poster.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return img.naturalWidth;
    }),
  ).toBe(400);
  expect(calls.filter((x) => x.includes('/data/images/')).length).toBe(1);
  expect(calls.some((x) => /shikimori.*\/api\//.test(x))).toBe(false);
  await context.unroute('https://poster-fixtures.invalid/**');
  // Use a distinct missing fixture: a previously decoded image can remain in WebKit's memory cache.
  images['3929'].posterDetailUrl = 'https://poster-fixtures.invalid/missing-original.jpg';
  await context.route('https://poster-fixtures.invalid/**', (route) => route.abort());
  await page.reload();
  await expect(poster).toHaveAttribute('src', /poster-placeholder.svg$/);
  await expect
    .poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(poster).toBeVisible();
  expect(
    await poster.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return img.naturalWidth > 0;
    }),
  ).toBe(true);
});
import { anime, staticPageIds, animePath } from '../src/data/anime';
import { imageUrl } from '../src/lib/images';
import { searchAnime } from '../src/lib/search';
const solo = anime.find((a) => a.shikimoriId === 52299)!;
test('главная, неизменный логотип, навигация и карусель реальных тайтлов', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.header .logo img')).toBeVisible();
  for (const section of await page.locator('.anime-section').all())
    expect(await section.locator('article').count()).toBeLessThanOrEqual(6);
  await expect(page.locator('.hero-slide.selected h1')).toHaveText(featuredAnime[0].title);
  await expect(page.locator('.hero-slide')).toHaveCount(5);
  await page.getByRole('button', { name: 'Следующий слайд' }).click();
  await expect(page.locator('.hero-slide.selected h1')).toHaveText(featuredAnime[1].title);
  await page.locator('.desktop-nav').getByRole('link', { name: 'Каталог' }).click();
  await expect(page).toHaveURL(/catalog\//);
  await expect(page.getByRole('heading', { name: 'Каталог аниме', exact: true })).toBeVisible();
});
test('поиск: русский, английский, оригинальный, алиасы, клавиатура и область охвата', async ({
  page,
}) => {
  await page.goto('./');
  const input = page.getByRole('combobox');
  for (const q of ['поднятие уровня', 'Solo Leveling', 'Ore dake', 'Соло левелинг']) {
    await input.fill(q);
    await expect(page.locator('#search-results')).toContainText(
      `Поиск по каталогу AniRezik · ${anime.length} аниме`,
    );
    await expect(page.locator('#search-results a[role="option"]')).toHaveCount(
      Math.min(6, searchAnime(anime, q).length),
    );
  }
  await input.fill('Соло левелинг');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/anime\/solo-leveling\//);
  await expect(page.locator('.detail-copy h1')).toHaveText(solo.title);
  await input.fill('Наруто');
  await expect(page.getByRole('option').first()).toBeVisible();
  await input.press('Escape');
  await expect(page.locator('#search-results')).toBeHidden();
  await input.fill('zzzz12345');
  await expect(page.locator('#search-results')).toContainText('Ничего не найдено');
});
test('Enter без выбранной подсказки открывает результаты каталога', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('combobox').fill('Магическая битва');
  await page.getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/catalog\/\?q=/);
  await expect(page.locator('#catalog-search')).toHaveValue('Магическая битва');
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(
    Math.min(24, searchAnime(anime, 'Магическая битва').length),
  );
});
test('настоящий каталог, пагинация, комбинированные фильтры и сортировка оценок', async ({
  page,
}) => {
  await page.goto('catalog/');
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(24);
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(48);
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-studio').selectOption('MAPPA', { force: true });
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-genre').selectOption('Экшен', { force: true });
  const filtered = anime.filter((a) => a.studios.includes('MAPPA') && a.genres.includes('Экшен'));
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(
    Math.min(24, filtered.length),
  );
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-sort').selectOption('rating', { force: true });
  const expected = [...filtered].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  await expect(page.locator('#catalog-grid article:visible').first()).toHaveAttribute(
    'data-anime-id',
    expected[0].id,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#filter-panel')).toBeHidden();
  await page.locator('#catalog-search').fill('unknown12345');
  await expect(page.locator('#catalog-empty')).toBeVisible();
  if (await page.locator('#filter-panel').isHidden()) await page.locator('.filter-toggle').click();
  await page.locator('#reset-filters').click();
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(24);
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-year').selectOption('2002', { force: true });
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-type').selectOption('TV', { force: true });
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-status').selectOption('Завершён', { force: true });
  const count = anime.filter(
    (a) => a.year === 2002 && a.type === 'TV' && a.status === 'Завершён',
  ).length;
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(Math.min(24, count));
});
test('карточка, достоверная информация и связанные сезоны без фиктивного просмотра', async ({
  page,
}) => {
  await page.goto('catalog/?q=Соло%20левелинг');
  await page.locator('#catalog-grid article:visible .card-link').first().click();
  await expect(page.locator('.detail-copy h1')).toHaveText(solo.title);
  await expect(page.getByText('A-1 Pictures', { exact: true })).toBeVisible();
  await expect(page.locator('.banner-rating')).toContainText(solo.score!.toFixed(1));
  await expect(page.locator('.description')).toHaveText(descriptions.get(solo.shikimoriId)!.text);
  for (const genre of solo.genres)
    await expect(
      page.locator('.detail-tags').getByRole('link', { name: genre, exact: true }),
    ).toBeVisible();
  await expect(page.locator('.detail-tags')).toContainText(solo.status);
  for (const [label, value] of [
    ['Всего по данным источника', solo.episodes ?? '—'],
    ['Вышло по данным источника', solo.episodesAired ?? '—'],
  ])
    await expect(
      page
        .locator('.anime-facts div')
        .filter({ has: page.getByText(String(label), { exact: true }) })
        .locator('dd'),
    ).toHaveText(String(value));
  await expect(page.getByRole('heading', { name: 'Связанные аниме и сезоны' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Хронология франшизы' })).toBeVisible();
  const localRelation = solo.related.find((relation) =>
    anime.some((item) => item.shikimoriId === relation.shikimoriId),
  )!;
  const relatedTitle = anime.find((item) => item.shikimoriId === localRelation.shikimoriId)!;
  await expect(
    page.locator('.franchise-track').getByRole('link').filter({ hasText: localRelation.title }),
  ).toHaveAttribute('href', new RegExp(`/anime/${relatedTitle.slug}/$`));
  await expect(
    page.locator('#anime-player').getByRole('heading', { name: solo.title, exact: true }),
  ).toBeVisible();
  await expect(page.locator('iframe,video,[data-video-episode],[data-video-dub]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /смотреть|воспроизвести/i })).toHaveCount(0);
  await expect(page.locator('.detail-poster')).toHaveAttribute(
    'src',
    imageUrl(solo.posterDetailUrl || solo.poster, process.env.BASE_PATH || '/'),
  );
});
test('избранное мигрирует со старых ID и сохраняет неизвестные записи', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('migration-test')) {
      localStorage.setItem(
        'anirezik:favorites:v1',
        JSON.stringify(['solo-leveling', 'naruto', 'future-legacy']),
      );
      localStorage.setItem('migration-test', '1');
    }
  });
  await page.goto('favorites/');
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(2);
  await expect(page.locator('#favorites-unavailable')).toContainText('1');
  await page.reload();
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(2);
  await page.locator('[data-favorite="shikimori:52299"]').click();
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(1);
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('anirezik:favorites:v2')!));
  expect(raw.unresolvedLegacyIds).toContain('future-legacy');
  expect(raw.entries[0].shikimoriId).toBe(20);
  expect(await page.evaluate(() => localStorage.getItem('anirezik:favorites:v1'))).toContain(
    'solo-leveling',
  );
});
test('избранное сохраняется после перезагрузки и безопасно читает повреждённый JSON', async ({
  page,
}) => {
  await page.goto('./');
  const button = page.locator('#popular [data-favorite="shikimori:52299"]');
  await button.click();
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.goto('favorites/');
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(1);
  await page.locator('[data-favorite="shikimori:52299"]').click();
  await expect(page.locator('#favorites-empty')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('anirezik:favorites:v2', '{broken'));
  await page.reload();
  await expect(page.locator('#favorites-empty')).toBeVisible();
});
test('мобильные меню, поиск и фильтр студии', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.genre-filter')).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  await page.getByRole('combobox').fill('Соло левелинг');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.locator('.mobile-nav').getByRole('link', { name: 'Каталог' }).click();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-studio').selectOption('ufotable', { force: true });
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(
    Math.min(24, anime.filter((a) => a.studios.includes('ufotable')).length),
  );
});
for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
  test(`ширина ${width} без переполнения главной, каталога и подробной страницы`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['./', 'catalog/', 'anime/solo-leveling/']) {
      await page.goto(route);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${route} ${width}`,
      ).toBeTruthy();
    }
  });
}
test('статические ресурсы, базовый путь, SEO, 404, отсутствие ошибок и запросов к API', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  page.on('request', (r) => {
    if (/shikimori.*\/api\//.test(r.url())) external.push(r.url());
  });
  await page.goto('./');
  const images = await page
    .locator('img')
    .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  const permitted = new Set(anime.flatMap((a) => [a.posterUrl, a.posterDetailUrl, a.backdropUrl]));
  for (const src of new Set(images)) {
    if (new URL(src).origin === new URL(page.url()).origin)
      expect((await request.get(src)).ok(), src).toBeTruthy();
    else
      expect(
        permitted.has(src),
        `External image must come from the approved registry: ${src}`,
      ).toBe(true);
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:/);
  await page.goto('anime/solo-leveling/');
  await page.goto('favorites/');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  const response = await page.goto('missing-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Эта история пока не найдена' })).toBeVisible();
});

test('рейтинг: единая жёлтая плашка в SSR, поиске, избранном и связанных миниатюрах', async ({
  page,
}) => {
  const value = solo.score!.toFixed(1);
  await page.goto('./');
  const badge = page.locator('#popular [data-anime-id="shikimori:52299"] .card-badge');
  await expect(badge).toHaveText(value);
  await expect(badge).toHaveAttribute(
    'aria-label',
    `Оценка пользователей Shikimori: ${value} из 10`,
  );
  expect(await badge.locator('svg').evaluate((svg) => getComputedStyle(svg).fill)).toBe(
    'rgb(255, 200, 61)',
  );
  expect(
    await badge.evaluate((b) => parseFloat(getComputedStyle(b).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  await page.locator('#global-search').fill('Solo Leveling');
  await expect(page.locator('#search-results .card-badge').first()).toHaveText(value);
  await page.locator('#popular [data-favorite="shikimori:52299"]').click();
  await page.goto('favorites/');
  await expect(page.locator('#favorites-grid .card-badge')).toHaveText(value);
  await page.goto('catalog/?q=Solo%20Leveling');
  await expect(page.locator('#catalog-grid .card-badge').first()).toHaveText(value);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator('#catalog-grid .card-badge')
      .first()
      .evaluate((b) => parseFloat(getComputedStyle(b).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  await page.goto('anime/?id=20');
  await expect(page.locator('.franchise-track .card-badge').first()).toBeVisible();
  await expect(page.locator('.franchise-track .card-badge').first()).toHaveClass(/rating-small/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('новый тайтл находится и имеет статическую страницу', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('combobox').fill('Log Horizon');
  await expect(page.getByRole('option')).toHaveCount(
    Math.min(6, searchAnime(anime, 'Log Horizon').length),
  );
  await page.getByRole('combobox').press('ArrowDown');
  await page.getByRole('combobox').press('Enter');
  await expect(page.locator('.detail-copy h1')).toContainText('Покорение горизонта');
});
test('поиск за пределами первоначальной тысячи открывает полноценные страницы и избранное', async ({
  page,
}) => {
  // These three IDs were absent from the saved 0.2.1 snapshot (see VALIDATION.md).
  for (const id of [322, 28297, 29803]) {
    const title = anime.find((a) => a.shikimoriId === id)!;
    await page.goto('./');
    await page.getByRole('combobox').fill(title.originalTitle);
    await page.locator(`#search-results a[href$="/anime/${title.slug}/"]`).click();
    await expect(page.locator('.detail-copy h1')).toHaveText(title.title);
    await expect(page.locator('.detail-copy .description')).not.toBeEmpty();
    await expect(page.getByRole('link', { name: 'Открыть на Shikimori ↗' })).toHaveAttribute(
      'href',
      title.sourceUrl,
    );
  }
  await page.locator('.detail-actions [data-favorite]').click();
  await page.goto('favorites/');
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(1);
  await expect(page.locator('#favorites-list article:visible')).toHaveAttribute(
    'data-anime-id',
    'shikimori:29803',
  );
  const missing = anime.find(
    (a) => !a.studios.length && !a.description && !descriptions.has(a.shikimoriId),
  )!;
  await page.goto(animePath(missing));
  await expect(page.locator('.description')).toContainText('Описание пока недоступно');
  await expect(
    page
      .locator('.anime-facts div')
      .filter({ has: page.getByText('Студии анимации', { exact: true }) })
      .locator('dd'),
  ).toHaveText('—');
});

test('реальное декодирование изображения и fallback при сетевом сбое', async ({ page }) => {
  // Both approved sizes must fail before the neutral fallback is expected.
  await page.route('https://shikimori.io/uploads/poster/**', (route) => route.abort('failed'));
  await page.goto('anime/solo-leveling/');
  const image = page.locator('.detail-poster');
  await expect(image).toHaveAttribute('src', /poster-placeholder.svg$/);
  await expect(image).toHaveClass(/image-failed/);
  await expect
    .poll(() =>
      image.evaluate(
        (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.locator('.detail-banner img')).toBeHidden();
  await expect(page.locator('.detail-banner')).toHaveClass(/neutral-banner/);
});
test('индекс загружается один раз как статический ресурс, ошибка поиска видима', async ({
  page,
  context,
}) => {
  await context.route('**/search-index.*', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('./');
  await page.getByRole('combobox').fill('Solo');
  await expect(page.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  const favorite = page.locator('#popular [data-favorite="shikimori:52299"]');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('главная и первые 24 карточки не загружают полный индекс или подробности', async ({
  page,
  context,
}) => {
  await page.clock.install();
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(page.getByRole('combobox')).toBeEnabled();
  expect(requests.filter((url) => /search-index|\/data\/anime\//.test(url))).toEqual([]);
  await page.goto('catalog/');
  await expect(page.locator('#catalog-grid article')).toHaveCount(24);
  expect(requests.filter((url) => /search-index|\/data\/anime\//.test(url))).toEqual([]);
  await expect(page.locator('#global-search')).toHaveCount(0);
  await page.locator('#catalog-search').fill('Solo Leveling');
  await expect(page.locator('#catalog-grid article').first()).toHaveAttribute(
    'data-anime-id',
    solo.id,
  );
  await page.locator('#catalog-search').fill('Naruto');
  await expect(page.locator('#catalog-grid article').first()).not.toHaveAttribute(
    'data-anime-id',
    solo.id,
  );
  expect(requests.filter((url) => url.includes('search-index.'))).toHaveLength(1);
  expect(page.workers()).toHaveLength(1);
  await page.clock.fastForward(61000);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.locator('#catalog-search').fill('Paradise Kiss');
  await expect(page.locator('#catalog-grid article')).toHaveCount(1);
  expect(page.workers()).toHaveLength(1);
});

test('редкий старый тайтл: универсальный маршрут, перезагрузка, поиск и избранное', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rare =
    anime.find((a) => !staticPageIds.has(a.shikimoriId) && a.year !== null && a.year < 1945) ||
    anime.find((a) => !staticPageIds.has(a.shikimoriId)) ||
    anime[0];
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await page.goto(`anime/?id=${rare.shikimoriId}`);
  await expect(page.locator('.detail-copy h1')).toHaveText(rare.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.filter((url) => url.includes('search-index.'))).toEqual([]);
  expect(requests.filter((url) => url.includes('/data/anime/'))).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.detail-copy h1')).toHaveText(rare.title);
  await page.locator('.detail-actions [data-favorite]').click();
  await page.goto('favorites/');
  await expect(page.locator('#favorites-grid article')).toHaveCount(1);
  await expect(page.locator('#favorites-grid h3')).toHaveText(rare.title);
  expect(requests.filter((url) => url.includes('search-index.'))).toEqual([]);
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  await page.getByRole('combobox').fill(rare.originalTitle);
  await expect(
    page.getByRole('option').filter({ has: page.getByText(rare.title, { exact: true }) }),
  ).toBeVisible();
  if (!staticPageIds.has(rare.shikimoriId))
    await expect(
      page.getByRole('option').filter({ has: page.getByText(rare.title, { exact: true }) }),
    ).toHaveAttribute('href', new RegExp(`/anime/\\?id=${rare.shikimoriId}$`));
});

test('универсальная страница честно обрабатывает неправильный ID, 404 и отказ JSON', async ({
  page,
  context,
}) => {
  await page.goto('anime/?id=invalid');
  await expect(page.locator('#anime-status')).toContainText('корректный Shikimori ID');
  await page.goto('anime/?id=999999999');
  await expect(page.locator('#anime-status')).toContainText('отсутствует');
  await context.route(`**/data/anime/${solo.shikimoriId}.json`, (route) =>
    route.fulfill({ status: 503, body: 'offline' }),
  );
  await page.goto(`anime/?id=${solo.shikimoriId}`);
  await expect(page.locator('#anime-status')).toContainText('Не удалось загрузить');
  await expect(page.locator('#anime-detail')).toBeHidden();
});

test('30 разрешённых тестовых HTTPS изображений декодируются; ошибка не вызывает цикл', async ({
  page,
  context,
}) => {
  // Our own SVG fixtures, not third-party anime posters or evidence of a provider license.
  const ids = anime.slice(0, 30).map((a) => a.shikimoriId),
    images = Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          poster: `https://licensed-fixtures.invalid/${i}.svg`,
          posterUrl: `https://licensed-fixtures.invalid/${i}.svg`,
          backdropUrl: null,
          imageSource: 'AniRezik test fixtures',
          imageAttribution: 'Own SVG fixture — test only',
          imageLicenseStatus: 'permission-granted',
        },
      ]),
    );
  await context.route('**/image-index.json', (route) =>
    route.fulfill({ json: { version: 2, sharded: false, images } }),
  );
  let brokenRequests = 0;
  await context.route('https://licensed-fixtures.invalid/**', (route) => {
    if (route.request().url().endsWith('/broken.svg')) {
      brokenRequests++;
      return route.abort('failed');
    }
    const number = route.request().url().split('/').pop();
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#25121c"/><text x="20" y="80" fill="white">Own test fixture ${number}</text></svg>`,
    });
  });
  await page.goto('catalog/');
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  const fixtures = page.locator(
    '#catalog-grid img[src^="https://licensed-fixtures.invalid/"],#catalog-grid img[data-image-src^="https://licensed-fixtures.invalid/"]',
  );
  // Packages now hydrate near the viewport, so distant fixtures must stay deferred.
  await expect(fixtures.first()).toBeVisible();
  expect(await fixtures.count()).toBeLessThan(30);
  for (let i = 0; i < 30; i++) {
    const image = page.locator(`#catalog-grid article[data-anime-id="shikimori:${ids[i]}"] img`);
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute('src', /^https:\/\/licensed-fixtures/);
    await expect
      .poll(() =>
        image.evaluate((node) => {
          const img = node as HTMLImageElement;
          return img.complete && img.naturalWidth > 0 && img.currentSrc === img.src;
        }),
      )
      .toBe(true);
    await expect(image).toHaveAttribute('loading', 'lazy');
    await expect(image).toHaveAttribute('decoding', 'async');
    await expect(image).not.toHaveAttribute('crossorigin', /.*/);
  }
  await expect(fixtures).toHaveCount(30);
  const first = page.locator('#catalog-grid article').first().locator('img');
  await first.evaluate(
    (img) => ((img as HTMLImageElement).src = 'https://licensed-fixtures.invalid/broken.svg'),
  );
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute('src', /poster-placeholder.svg$/);
  await expect
    .poll(() => first.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(brokenRequests).toBe(1);
});

test('пакеты изображений загружаются у экрана, кешируются и отвергают повреждение', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const selected = anime.slice(0, 48);
  const calls: number[] = [];
  const posters: string[] = [];
  let indexCalls = 0;
  const buckets = [...new Set(selected.map((a) => Math.floor(a.shikimoriId / 1000)))];
  await context.route('**/image-index.json', (route) => {
    indexCalls++;
    return route.fulfill({ json: { version: 2, sharded: true, buckets, images: {} } });
  });
  await context.route('**/data/images/*.json', async (route) => {
    const bucket = Number(route.request().url().split('/').pop()!.split('.')[0]);
    calls.push(bucket);
    const images = Object.fromEntries(
      selected
        .filter((a) => Math.floor(a.shikimoriId / 1000) === bucket)
        .map((a) => [
          a.shikimoriId,
          {
            poster: `https://lazy-fixtures.invalid/${a.shikimoriId}.svg`,
            posterUrl: null,
            backdropUrl: null,
            imageSource: 'Own fixture',
            imageAttribution: 'Own test only',
            imageLicenseStatus: 'permission-granted',
          },
        ]),
    );
    await route.fulfill({ json: images });
  });
  await context.route('https://lazy-fixtures.invalid/**', (route) => {
    posters.push(route.request().url());
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#800"/></svg>',
    });
  });
  await page.goto('catalog/');
  await page.addStyleTag({ content: 'html {scroll-behavior:auto !important}' });
  // Keep the viewport at the first row while appending; scrolling across all rows
  // would legitimately request their images and invalidate a cold-viewport measure.
  await page.locator('#load-more').evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('#catalog-grid article')).toHaveCount(48);
  await page.evaluate(() => scrollTo(0, 0));
  const first = page.locator('#catalog-grid article').first().locator('img');
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute('src', /^https:\/\/lazy-fixtures/);
  expect(posters.length).toBeLessThan(24);
  expect(calls.length).toBeLessThan(buckets.length);
  const last = page.locator('#catalog-grid article').last().locator('img');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute('src', /^https:\/\/lazy-fixtures/);
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-sort').selectOption('title', { force: true });
  await expect(page.locator('#catalog-grid')).not.toHaveAttribute('aria-busy', 'true');
  if ((await page.locator('.filter-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('.filter-toggle').click();
  await page.locator('#filter-sort').selectOption('default', { force: true });
  await expect(page.locator('#catalog-grid article')).toHaveCount(24);
  await page.locator('#catalog-grid article').first().scrollIntoViewIfNeeded();
  expect(indexCalls).toBe(1);
  expect(calls.length).toBe(new Set(calls).size);
  expect(posters.some((url) => url.includes('/api/'))).toBe(false);

  await context.unroute('**/data/images/*.json');
  await context.route('**/data/images/*.json', (route) =>
    route.fulfill({ json: { invalid: { poster: 123 } } }),
  );
  await page.reload();
  if (await page.locator('#filter-panel').isVisible()) await page.keyboard.press('Escape');
  await page.locator('#catalog-search').fill('Solo Leveling');
  await expect(page.locator('#catalog-grid h3').first()).toHaveText(solo.title);
  const broken = page.locator('#catalog-grid article').first().locator('img');
  await broken.scrollIntoViewIfNeeded();
  await expect(broken).toHaveAttribute('src', /poster-placeholder.svg$/);
  await expect
    .poll(() => broken.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test('запоздалый пакет постеров не меняет карточки нового поиска', async ({ page, context }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const waiting = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await context.route('**/image-index.json', (route) =>
    route.fulfill({ json: { version: 2, sharded: true, buckets: [52], images: {} } }),
  );
  await context.route('**/data/images/52.json', async (route) => {
    requested();
    await gate;
    await route.fulfill({
      json: {
        52299: {
          poster: 'https://stale-fixture.invalid/solo.svg',
          posterUrl: null,
          backdropUrl: null,
          imageSource: 'Own fixture',
          imageAttribution: 'Test',
          imageLicenseStatus: 'permission-granted',
        },
      },
    });
  });
  await page.goto('catalog/');
  if (await page.locator('#filter-panel').isVisible()) await page.keyboard.press('Escape');
  await page.locator('#catalog-search').fill('Solo Leveling');
  await page.locator('#catalog-grid').scrollIntoViewIfNeeded();
  await waiting;
  await page.locator('#catalog-search').fill('Naruto');
  await expect(page.locator('.result-count')).toContainText('Найдено:');
  await expect(page.locator('#catalog-grid h3').first()).not.toHaveText(solo.title);
  release();
  await expect(page.locator('#catalog-grid img[src*="stale-fixture"]')).toHaveCount(0);
});

test('постеры ID 1, 5, 59193 и связанные сезоны: compact/original, decode и CDN fallback', async ({
  page,
  context,
}) => {
  const ids = [1, 5, 59193];
  const all = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        poster: `https://permission-fixtures.invalid/main-${id}.svg`,
        posterUrl: `https://permission-fixtures.invalid/main-${id}.svg`,
        posterDetailUrl: `https://permission-fixtures.invalid/original-${id}.svg`,
        backdropUrl: null,
        imageSource: 'Own SVG fixture',
        imageAttribution: 'Own fixture — no Shikimori permission',
        imageLicenseStatus: 'permission-granted',
      },
    ]),
  );
  await context.route('**/image-index.json', (r) =>
    r.fulfill({ json: { version: 2, sharded: false, images: all } }),
  );
  await context.route('https://permission-fixtures.invalid/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#800"/></svg>',
    }),
  );
  const calls: string[] = [];
  context.on('request', (r) => calls.push(r.url()));
  for (const id of ids) {
    await page.goto(`anime/?id=${id}`);
    const img = page.locator('.detail-poster');
    await expect(img).toHaveAttribute('src', all[id].posterDetailUrl);
    await expect
      .poll(() =>
        img.evaluate(
          (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    expect(
      await img.evaluate(async (i) => {
        await (i as HTMLImageElement).decode();
        return (i as HTMLImageElement).naturalWidth;
      }),
    ).toBe(400);
    if (id === 1) {
      const thumb = page
        .locator('.franchise-track a')
        .filter({ hasText: anime.find((a) => a.shikimoriId === 5)!.title })
        .locator('img');
      await thumb.scrollIntoViewIfNeeded();
      await expect(thumb).toHaveAttribute('src', all[5].poster);
      await expect
        .poll(() => thumb.evaluate((i) => (i as HTMLImageElement).naturalWidth))
        .toBe(400);
      await expect(thumb).toHaveAttribute('loading', 'lazy');
      await expect(thumb).not.toHaveAttribute('title', /Own fixture/);
      await expect(page.locator('.franchise-track .related-credit')).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('anime/?id=1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.detail-poster')).toHaveAttribute('src', all[1].posterDetailUrl);
  await context.unroute('https://permission-fixtures.invalid/**');
  let errors = 0;
  all[1].posterDetailUrl = 'https://permission-fixtures.invalid/new-missing.svg';
  await context.route('https://permission-fixtures.invalid/**', (r) => {
    errors++;
    return r.abort('failed');
  });
  await page.reload();
  await expect(page.locator('.detail-poster')).toHaveAttribute('src', /poster-placeholder.svg$/);
  expect(errors).toBeLessThan(5);
  expect(calls.some((u) => /shikimori.*\/api\//.test(u))).toBe(false);
});

test('статические связанные сезоны используют общий lazy poster и сохраняют мобильную разметку', async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const item = anime.find((a) => a.shikimoriId === 1)!;
    await page.goto(`anime/${item.slug}/`);
    const img = page.locator('.franchise-track img').first();
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('decoding', 'async');
    await expect
      .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('история трёх просмотров, detail actions и мобильный поиск без скачка', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (window as Window & { copied?: string }).copied = text;
        },
      },
      configurable: true,
    });
  });
  for (const id of [1, 5, 59193]) {
    await page.goto(`anime/?id=${id}`);
    await expect(page.locator('.detail-copy h1')).toBeVisible();
  }
  await page.locator('[data-share-anime]').click();
  await expect(page.locator('[data-share-anime]')).toHaveText('Ссылка скопирована');
  expect(await page.evaluate(() => (window as Window & { copied?: string }).copied)).toBe(
    page.url(),
  );
  await page.getByRole('link', { name: 'СМОТРЕТЬ' }).click();
  await expect(page.locator('#anime-player')).toBeInViewport();
  await expect(page.locator('#anime-player')).toContainText('Релиз пока не найден');
  await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.goto('./');
  await expect(page).toHaveTitle('AniRezik');
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await page.locator('main').boundingBox();
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  const input = page.getByRole('combobox');
  await expect(page.locator('#search-results')).toContainText('Недавно просмотрено');
  await expect(page.locator('#search-results [role=option]')).toHaveCount(3);
  await expect(page.locator('#search-results [role=option] img')).toHaveCount(3);
  await expect(page.locator('#search-results [role=option] img').first()).toHaveAttribute(
    'src',
    /^https:\/\/shikimori\.io\//,
  );
  expect((await page.locator('main').boundingBox())!.y).toBe(before!.y);
  expect(await input.evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px');
  await input.fill('Solo Leveling');
  await expect(page.locator('#search-results')).not.toContainText('Недавно просмотрено');
  await expect(page.locator('#search-results [role=option]').first()).toBeVisible();
  await input.fill('');
  await expect(page.locator('#search-results [role=option]')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('хронология с постерами, компактные фильтры и плавная навигация', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.genre-filter,.editorial-strip,.genres-section')).toHaveCount(0);
  const pill = page.locator('.nav-highlight');
  await expect(pill).toHaveCSS('opacity', '1');
  const before = await pill.evaluate((node) => node.style.transform);
  await page.locator('.desktop-nav a').nth(1).hover();
  expect(await pill.evaluate((node) => node.style.transform)).toBe(before);
  await page.locator('.desktop-nav a').nth(1).click();
  await expect(page.locator('#filter-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await expect(page.locator('#filter-panel')).toBeVisible();
  await page.locator('#filter-type').selectOption('Фильм', { force: true });
  await expect(page.locator('#catalog-grid article').first()).toHaveAttribute('data-type', 'Фильм');
  for (const path of ['anime/solo-leveling/', 'anime/?id=59193']) {
    await page.goto(path);
    const track = page.locator('.franchise-track');
    await track.scrollIntoViewIfNeeded();
    await expect(track.locator('li.current')).toHaveCount(1);
    await expect(track.locator('li.current')).toContainText('ВЫ ЗДЕСЬ');
    const img = track.locator('img').first();
    await expect(img).toHaveAttribute('src', /^https:\/\/shikimori\.io\//);
    await expect
      .poll(() => img.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.locator('.chronology-section + #similar-anime')).toBeVisible();
    await expect(page.locator('[data-share-anime] svg')).toHaveCount(1);
    await expect(page.locator('.detail-actions [data-favorite] svg')).toHaveCount(1);
    await track.getByRole('link').first().click();
    await expect(page.locator('.detail-copy h1')).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.chronology-section')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('окно фильтров: темы/оценка, новости, стрелки и длинное описание', async ({
  page,
  context,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новости сайта' }).click();
  await expect(page.locator('#site-news')).toContainText('0.3.9');
  await page.getByRole('button', { name: 'Закрыть новости' }).click();
  await page.goto('catalog/');
  await expect(page.locator('#global-search')).toHaveCount(0);
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const item = anime.find((a) => a.themes.length && (a.score ?? 0) >= 8)!;
  await page.locator('#filter-theme').selectOption(item.themes[0], { force: true });
  await page.locator('#filter-minScore').selectOption('8', { force: true });
  await expect(page.getByRole('combobox', { name: 'Озвучка — пока недоступна' })).toBeDisabled();
  await page.keyboard.press('Escape');
  const expected = anime.filter((a) => a.themes.includes(item.themes[0]) && (a.score ?? 0) >= 8);
  await expect(page.locator('#catalog-grid article')).toHaveCount(Math.min(24, expected.length));
  await expect(page.locator('.result-count')).toContainText(`Найдено: ${expected.length}`);
  await context.route('**/data/descriptions/1.json', (r) =>
    r.fulfill({
      json: {
        id: 1,
        text: 'Длинный разрешённый тестовый текст. '.repeat(35),
        attribution: 'TVmaze fixture',
        sourceUrl: 'https://www.tvmaze.com/shows/1121/cowboy-bebop',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        language: 'ru',
      },
    }),
  );
  await page.goto('anime/?id=1');
  await page.getByRole('button', { name: 'Развернуть описание' }).click();
  await expect(page.locator('.description')).not.toHaveClass(/description-collapsed/);
  await page.getByRole('button', { name: 'Свернуть описание' }).click();
  await expect(page.locator('.description')).toHaveClass(/description-collapsed/);
  await page.goto('anime/?id=59193');
  const track = page.locator('.franchise-track');
  await track.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Следующие тайтлы' }).click();
  await expect.poll(() => track.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Предыдущие тайтлы' }).click();
  await expect.poll(() => track.evaluate((e) => Math.round(e.scrollLeft))).toBe(0);
  await expect(page.getByRole('link', { name: 'СМОТРЕТЬ' })).toHaveAttribute(
    'href',
    '#anime-player',
  );
});

test('описания Shikimori на статической и универсальной странице, collapse и отказ', async ({
  page,
  context,
}) => {
  for (const id of [36027, 1, 5]) {
    const item = anime.find((a) => a.shikimoriId === id)!;
    await page.goto(id === 1 || !staticPageIds.has(id) ? `anime/?id=${id}` : `anime/${item.slug}/`);
    await expect(page.locator('.description')).toHaveText(descriptions.get(id)!.text);
    await expect(page.locator('.description-credit')).toHaveCount(0);
    await expect(page.locator('.description')).not.toContainText('[character=');
    await expect(page.locator('[data-editorial-credit]')).toHaveCount(0);
  }
  await page.goto('anime/?id=36027');
  await page.getByRole('button', { name: 'Развернуть описание' }).click();
  await expect(page.locator('.description')).not.toHaveClass(/description-collapsed/);
  await context.route('**/data/descriptions/36027.json', (r) => r.abort());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Повторить загрузку описания' })).toBeVisible();
  await context.unroute('**/data/descriptions/36027.json');
  await page.getByRole('button', { name: 'Повторить загрузку описания' }).click();
  await expect(page.locator('.description')).toHaveText(descriptions.get(36027)!.text);
});

test('0.3.11: четыре списка коллекции и история открытий', async ({ page }) => {
  await page.goto('anime/?id=36027');
  const picker = page.locator('.list-picker');
  await picker.locator('> button').click();
  await expect(picker.locator('.list-options button')).toHaveCount(4);
  await picker.getByRole('button', { name: 'В планах', exact: true }).click();
  await expect(picker.locator('> button')).toContainText('В планах');
  await page.goto('collection/');
  await page.getByRole('button', { name: 'В планах', exact: true }).click();
  await expect(page.locator('[data-anime-id="shikimori:36027"]')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'В планах', exact: true }).click();
  await expect(page.locator('[data-anime-id="shikimori:36027"]')).toBeVisible();
  await page.goto('history/');
  await expect(page.locator('[data-anime-id="shikimori:36027"]')).toBeVisible();
  await page.getByRole('button', { name: 'Очистить историю' }).click();
  await expect(page.locator('[data-library-status]')).toContainText('пока нет');
});
test('0.3.11: тёмные списки, диапазон лет и стабильная навигация', async ({ page }) => {
  await page.goto('./');
  const before = await page.locator('.desktop-nav').boundingBox();
  await page.goto('catalog/');
  const after = await page.locator('.desktop-nav').boundingBox();
  if (before && after) expect(Math.abs(before.x - after.x)).toBeLessThan(2);
  await expect(
    page.getByRole('link', { name: 'История просмотров', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const genre = page.locator('#filter-genre + .custom-select');
  await genre.locator('.select-trigger').click();
  await genre.getByRole('option', { name: 'Экшен', exact: true }).click();
  await expect(page.locator('#filter-genre')).toHaveValue('Экшен');
  for (const [id, value] of [
    ['yearFrom', '2000'],
    ['yearTo', '2005'],
  ])
    await page.locator(`#filter-${id}`).evaluate((node, value) => {
      const input = node as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  await expect(page).toHaveURL(/yearFrom=2000/);
  await expect(page.locator('#year-to-label')).toHaveText('2005');
  await page.getByRole('button', { name: 'Закрыть фильтры' }).click();
  await expect(page.locator('#filter-panel')).not.toBeVisible();
  await expect(page.locator('.result-count')).not.toContainText('Показано');
  await expect(page.locator('#catalog-grid .anime-card').first()).toBeVisible();
});

test('0.3.12: удаление из коллекции и три мобильные карточки', async ({ page }) => {
  await page.goto('anime/?id=36027');
  await page.locator('.list-picker > button').click();
  await page.locator('.list-options').getByRole('button', { name: 'Смотрю', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить из коллекции', exact: true }).click();
  await expect(page.locator('.list-picker > button')).toContainText('Добавить в список');
  await page.locator('.list-picker > button').click();
  await page
    .locator('.list-options')
    .getByRole('button', { name: 'В планах', exact: true })
    .click();
  await page.goto('collection/');
  await page.getByRole('button', { name: 'В планах', exact: true }).click();
  await expect(page.locator('[data-anime-id="shikimori:36027"]')).toBeVisible();
  await expect(page.locator('[data-library-count]')).toContainText('1');
  await page.getByRole('button', { name: /Удалить из коллекции:/ }).click();
  await expect(page.locator('[data-library-status]')).toContainText('пока нет');
  await page.reload();
  await page.getByRole('button', { name: 'В планах', exact: true }).click();
  await expect(page.locator('[data-anime-id="shikimori:36027"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('catalog/');
  const boxes = await page.locator('#catalog-grid article').evaluateAll((items) =>
    items.slice(0, 3).map((e) => ({
      top: e.getBoundingClientRect().top,
      right: e.getBoundingClientRect().right,
    })),
  );
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
  expect(boxes[2].right).toBeLessThanOrEqual(390);
  await expect(page.locator('.footer-brand')).not.toContainText('Источники изображений');
  await page.goto('anime/?id=59193');
  const track = page.locator('.franchise-track');
  await expect(track.locator('li').nth(2)).toBeAttached();
  const widths = await track.evaluate((e) => ({
    available: e.clientWidth,
    third:
      e.querySelectorAll('li')[2].getBoundingClientRect().right - e.getBoundingClientRect().left,
  }));
  expect(widths.third).toBeLessThanOrEqual(widths.available + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('0.3.13: топ-5 с постерами, общие кнопки шапки и стрелки только при переполнении', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('.header-library-links a')).toHaveCount(2);
  await expect(page.locator('.hero-watermark')).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    if (i) await page.locator(`[data-slide-to="${i}"]`).click();
    const slide = page.locator('.hero-slide.selected');
    await expect(slide.locator('h1')).toHaveText(featuredAnime[i].title);
    await expect(slide.locator('.hero-poster')).toHaveAttribute(
      'src',
      featuredAnime[i].posterDetailUrl || featuredAnime[i].poster,
    );
    await expect(slide.locator('.hero-score')).toContainText(featuredAnime[i].score!.toFixed(1));
    await expect(slide.locator('.hero-image')).toHaveCSS('filter', /blur/);
  }
  await page.goto('anime/?id=1');
  await expect(page.locator('.chronology-arrow')).toHaveCount(2);
  await expect(page.locator('.chronology-arrow').first()).toBeHidden();
  await expect(page.locator('.chronology-arrow').last()).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('anime/?id=59193');
  await expect(page.locator('.chronology-arrow.next')).toBeVisible();
  await expect(page.locator('.related-list')).toHaveCount(0);
});

test('0.3.14: компактная шапка и баннер, избранное внутри коллекции', async ({ page }) => {
  await page.goto('./');
  await expect(
    page.locator('.brand-cluster a[aria-label="Telegram"],.brand-cluster a[aria-label="Discord"]'),
  ).toHaveCount(0);
  await expect(page.locator('.desktop-favorite')).toHaveAttribute('href', /profile\/$/);
  await expect(page.locator('.desktop-nav').getByRole('link', { name: 'ИНФА' })).toHaveAttribute(
    'href',
    '#site-footer',
  );
  const width = await page
    .locator('#global-search')
    .evaluate((e) => e.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(170);
  expect(
    await page.locator('.nav-highlight').evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThan(60);
  await page.goto('schedule/');
  await expect(page.locator('#global-search')).toBeVisible();
  await page.goto('./');
  await page.locator('#popular [data-favorite="shikimori:52299"]').click();
  await page.goto('collection/?list=favorites');
  await expect(page.getByRole('button', { name: 'Избранные аниме', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-anime-id="shikimori:52299"]')).toBeVisible();
  await page.locator('[data-favorite="shikimori:52299"]').click();
  await expect(page.locator('[data-library-status]')).toContainText('пока нет');
  for (const viewport of [320, 390]) {
    await page.setViewportSize({ width: viewport, height: 844 });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Следующий слайд', exact: true })).toBeVisible();
    await expect(page.locator('.hero-slide.selected .hero-description')).toBeHidden();
    await expect(page.locator('.hero-slide.selected [data-favorite]')).toBeHidden();
    expect(
      await page.locator('.hero').evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(351);
    expect(
      await page
        .locator('.header-library-links a')
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(32);
    await expect(
      page.locator('.mobile-nav').getByRole('link', { name: 'Коллекция', exact: true }),
    ).toHaveAttribute('href', /collection\/$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
});

test('0.4.0: плеер ленивый, ошибка видима, при смене слота один video', async ({ page }) => {
  let requests = 0;
  await page.route('https://media.w3.org/**', (route) => {
    requests++;
    return route.fulfill({ status: 503, body: 'unavailable' });
  });
  await page.goto('player-test/');
  await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true');
  expect(requests).toBe(0);
  await expect(page.locator('video')).not.toHaveAttribute('src', /.+/);
  await page.locator('.player-big-play').click();
  await expect(page.locator('.player-status')).toContainText(/Ошибка|не смог/);
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  await page.locator('[data-video-episode]').selectOption('2');
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('video')).not.toHaveAttribute('src', /.+/);
  await expect(page.getByRole('button', { name: 'Следующая →', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

import libertyFixture from './fixtures/aniliberty.json' with { type: 'json' };
test('0.4.1: точный поиск сохраняется, серия выбирается, второй маршрут работает', async ({
  page,
}) => {
  let searches = 0;
  await page.route('https://anilibria.top/api/v1/**', async (route) => {
    const address = new URL(route.request().url());
    if (address.pathname.includes('/search/')) {
      searches++;
      await route.fulfill({ json: libertyFixture });
    } else {
      const id = Number(address.pathname.split('/').at(-1));
      await route.fulfill({ json: libertyFixture.find((r) => r.id === id) });
    }
  });
  await page.goto('anime/?id=40748');
  await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-video-dub]')).toContainText('AniLiberty');
  await expect(page.locator('[data-video-episode] option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Выбрать серию 2', exact: true }).click();
  await expect(page.locator('[data-video-episode]')).toHaveValue('2');
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('video')).not.toHaveAttribute('src', /.+/);
  expect(searches).toBe(1);
  await page.reload();
  await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true');
  expect(searches).toBe(1);
  await page.goto('anime/solo-leveling/');
  await expect(page.locator('[data-player]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[aria-label="Качество"] option')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
