import { test, expect } from '@playwright/test';

test('production: неподтверждённый Shikimori отключён независимо от локального переключателя', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'shikimori.io') requests.push(r.url());
  });
  const config = await (await page.request.get('image-index.json')).json();
  expect(config.experimental).toBe(false);
  expect(config.sharded).toBe(false);
  expect(config.buckets).toEqual([]);
  expect(
    Object.values(config.images).every(
      (a: any) =>
        a.imageLicenseStatus === 'original-ai' || a.imageLicenseStatus === 'permission-granted',
    ),
  ).toBe(true);
  await page.goto('anime/?id=3929');
  await expect(page.locator('.detail-poster')).toBeVisible();
  await expect(page.locator('.detail-poster')).toHaveAttribute('src', /poster-placeholder.svg$/);
  expect(requests).toEqual([]);
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
import { anime, staticPageIds } from '../src/data/anime';
import { searchAnime } from '../src/lib/search';
const solo = anime.find((a) => a.shikimoriId === 52299)!;
test('главная, неизменный логотип, навигация и карусель реальных тайтлов', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.header .logo img')).toBeVisible();
  for (const section of await page.locator('.anime-section').all())
    expect(await section.locator('article').count()).toBeLessThanOrEqual(6);
  await expect(page.locator('.hero-slide.selected h1')).toHaveText(
    solo.englishTitle || solo.originalTitle,
  );
  await page.getByRole('button', { name: 'Следующий слайд' }).click();
  await expect(page.locator('.hero-slide.selected h1')).toHaveText(
    anime.find((a) => a.shikimoriId === 38000)!.englishTitle ||
      anime.find((a) => a.shikimoriId === 38000)!.originalTitle,
  );
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
  await page.locator('#filter-studio').selectOption('MAPPA');
  await page.locator('#filter-genre').selectOption('Экшен');
  const filtered = anime.filter((a) => a.studios.includes('MAPPA') && a.genres.includes('Экшен'));
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(
    Math.min(24, filtered.length),
  );
  await page.locator('#filter-sort').selectOption('rating');
  const expected = [...filtered].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  await expect(page.locator('#catalog-grid article:visible').first()).toHaveAttribute(
    'data-anime-id',
    expected[0].id,
  );
  await page.locator('#catalog-search').fill('unknown12345');
  await expect(page.locator('#catalog-empty')).toBeVisible();
  await page.locator('#reset-filters').click();
  await expect(page.locator('#catalog-grid article:visible')).toHaveCount(24);
  await page.locator('#filter-year').selectOption('2002');
  await page.locator('#filter-type').selectOption('TV');
  await page.locator('#filter-status').selectOption('Завершён');
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
  await expect(page.locator('.source-rating')).toContainText(`${solo.score!.toFixed(2)}/10`);
  await expect(page.locator('.description')).toHaveText(solo.description);
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
  await expect(page.getByRole('heading', { name: 'Связанные аниме и сезоны' })).toBeVisible();
  const localRelation = solo.related.find((relation) =>
    anime.some((item) => item.shikimoriId === relation.shikimoriId),
  )!;
  const relatedTitle = anime.find((item) => item.shikimoriId === localRelation.shikimoriId)!;
  await expect(
    page.locator('.related-list').getByRole('link', { name: localRelation.title, exact: true }),
  ).toHaveAttribute('href', new RegExp(`/anime/${relatedTitle.slug}/$`));
  await expect(page.getByRole('heading', { name: 'Где посмотреть' })).toBeVisible();
  await expect(page.locator('iframe,video,[data-video-episode],[data-video-dub]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /смотреть|воспроизвести/i })).toHaveCount(0);
  await expect(page.locator('.detail-poster')).toHaveAttribute('src', /poster-1.webp$/);
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
  for (const genre of ['Романтика', 'Спорт', 'Драма', 'Фэнтези']) {
    await page.getByRole('button', { name: genre, exact: true }).click();
    for (const section of await page.locator('.anime-section').all()) {
      const count = await section
        .locator('[data-anime-id]')
        .evaluateAll(
          (cards, g) =>
            cards.filter((card) => card.getAttribute('data-genres')?.split('|').includes(g)).length,
          genre,
        );
      await expect(section.locator('article:visible')).toHaveCount(Math.min(4, count));
    }
  }
  await page.getByRole('button', { name: 'Все аниме', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть поиск' }).click();
  await page.getByRole('combobox').fill('Соло левелинг');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.locator('.mobile-nav').getByRole('link', { name: 'Каталог' }).click();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await page.locator('#filter-studio').selectOption('ufotable');
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
  for (const src of new Set(images)) expect((await request.get(src)).ok(), src).toBeTruthy();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:/);
  await page.goto('anime/solo-leveling/');
  await page.goto('favorites/');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  const response = await page.goto('missing-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Эта история пока не найдена' })).toBeVisible();
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
  await page.locator('.detail-copy [data-favorite]').click();
  await page.goto('favorites/');
  await expect(page.locator('#favorites-list article:visible')).toHaveCount(1);
  await expect(page.locator('#favorites-list article:visible')).toHaveAttribute(
    'data-anime-id',
    'shikimori:29803',
  );
  const missing = anime.find((a) => !a.studios.length && !a.description)!;
  await page.goto(`anime/${missing.slug}/`);
  await expect(page.locator('.description')).toContainText(
    'Редакционное описание пока не добавлено',
  );
  await expect(
    page
      .locator('.anime-facts div')
      .filter({ has: page.getByText('Студии анимации', { exact: true }) })
      .locator('dd'),
  ).toHaveText('—');
});

test('реальное декодирование изображения и fallback при сетевом сбое', async ({ page }) => {
  await page.route('**/assets/poster-1.webp', (route) => route.abort('failed'));
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
  await expect(page.locator('.detail-banner img')).toHaveAttribute('src', /hero.webp$/);
  await expect
    .poll(() =>
      page
        .locator('.detail-banner img')
        .evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await page.route('**/assets/hero.webp', (route) => route.abort('failed'));
  await page.reload();
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
  await page.getByRole('combobox', { name: 'Поиск аниме' }).fill('Solo Leveling');
  await expect(page.locator('#search-results [role=option]').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Поиск аниме' }).fill('Naruto');
  await expect(page.locator('#search-results [role=option]').first()).toBeVisible();
  expect(requests.filter((url) => url.includes('search-index.'))).toHaveLength(1);
  expect(page.workers()).toHaveLength(1);
  await page.clock.fastForward(61000);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole('combobox', { name: 'Поиск аниме' }).fill('Paradise Kiss');
  await expect(page.locator('#search-results [role=option]').first()).toBeVisible();
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
  await page.locator('.detail-copy [data-favorite]').click();
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
  await page.locator('#filter-sort').selectOption('title');
  await expect(page.locator('#catalog-grid')).not.toHaveAttribute('aria-busy', 'true');
  await page.locator('#filter-sort').selectOption('default');
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
  await page.locator('#catalog-search').fill('Solo Leveling');
  await page.locator('#catalog-grid').scrollIntoViewIfNeeded();
  await waiting;
  await page.locator('#catalog-search').fill('Naruto');
  await expect(page.locator('.result-count')).toContainText('Показано:');
  await expect(page.locator('#catalog-grid h3').first()).not.toHaveText(solo.title);
  release();
  await expect(page.locator('#catalog-grid img[src*="stale-fixture"]')).toHaveCount(0);
});
