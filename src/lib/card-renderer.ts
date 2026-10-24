import type { CatalogEntry } from './catalog-index';
import type { ClientImages } from './image-service';
import { fallbackImages } from './image-service';
import { url } from './paths';
import { initImages, releaseImages } from './image-client';
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function favoriteButton(id: string, large = false) {
  const button = element('button', `favorite-button${large ? ' favorite-large' : ''}`);
  button.dataset.favorite = id;
  button.disabled = true;
  button.setAttribute('aria-label', 'Добавить в избранное');
  button.setAttribute('aria-pressed', 'false');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    width: '22',
    height: '22',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', large ? 'M12 5v14M5 12h14' : 'M6 3h12v18l-6-4-6 4z');
  svg.append(path);
  button.append(svg);
  if (large) button.append(element('span', '', 'В избранное'));
  return button;
}
export function posterImage(images: ClientImages, title: string, className = '', defer = false) {
  const img = element('img', className);
  img.width = 400;
  img.height = 600;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.style.objectFit = 'cover';
  img.alt =
    images.imageLicenseStatus === 'original-ai'
      ? `AI-иллюстрация: ${title}, не официальный постер`
      : images.imageLicenseStatus === 'permission-granted' ||
          images.imageLicenseStatus === 'local-experiment'
        ? `Постер: ${title}`
        : `Фирменная заглушка: ${title}`;
  img.dataset.imageFallback = url('assets/poster-placeholder.svg');
  if (defer) {
    img.dataset.imageSrc = images.poster;
    img.src = img.dataset.imageFallback;
  } else img.src = images.poster;
  return img;
}
export function renderCards(
  grid: HTMLElement,
  entries: CatalogEntry[],
  images: Record<string, ClientImages>,
) {
  const fragment = document.createDocumentFragment();
  for (const a of entries) {
    const art = images[a.shikimoriId] || fallbackImages();
    const card = element('article', 'anime-card');
    Object.assign(card.dataset, {
      animeId: a.id,
      genres: a.genres.join('|'),
      year: a.year ?? '',
      type: a.type,
      status: a.status,
      studios: a.studios.join('|'),
      score: a.score ?? '',
      title: a.title,
    });
    const link = element('a', 'card-link');
    link.href = a.href;
    link.append(posterImage(art, a.title, '', true));
    if (art.imageAttribution)
      link.append(
        element(
          'span',
          'art-label',
          art.imageLicenseStatus === 'original-ai'
            ? 'AI · НЕОФИЦИАЛЬНЫЙ АРТ'
            : art.imageAttribution,
        ),
      );
    link.append(element('div', 'card-shade'));
    if (a.score) link.append(element('span', 'card-badge', `★ ${a.score.toFixed(2)} · Shikimori`));
    const info = element('div', 'card-info');
    info.append(
      element('span', 'card-original', a.originalTitle),
      element('h3', '', a.title),
      element(
        'p',
        '',
        `${a.type} · ${a.year ?? '—'} · ${a.episodes === null ? 'Серии: —' : a.type === 'Фильм' ? 'Фильм' : `${a.episodes} серий`}`,
      ),
    );
    link.append(info);
    card.append(link, favoriteButton(a.id));
    fragment.append(card);
  }
  releaseImages(grid);
  grid.replaceChildren(fragment);
  initImages(grid);
  document.dispatchEvent(new Event('anirezik:cards-rendered'));
}
