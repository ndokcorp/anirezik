import { initImages, releaseImages } from './image-client';
import { recentAnime } from './recent-anime';
import { queryCatalog } from './catalog-service';
import { loadImages, fallbackImages } from './image-service';
import { url } from './paths';
import type { Anime } from '../types/anime';
import { ratingBadge } from './rating';
export type SearchEntry = Pick<
  Anime,
  | 'id'
  | 'slug'
  | 'title'
  | 'originalTitle'
  | 'englishTitle'
  | 'japaneseTitle'
  | 'aliases'
  | 'poster'
  | 'year'
  | 'score'
> & { href: string };
export function initSearch() {
  const input = document.querySelector<HTMLInputElement>('#global-search');
  const results = document.querySelector<HTMLElement>('#search-results');
  if (!input || !results) return;
  input.placeholder = 'Поиск по каталогу...';
  let revision = 0;
  let selected = -1;
  const close = () => {
    revision++;
    input.removeAttribute('aria-busy');
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    selected = -1;
  };
  async function search() {
    const current = ++revision;
    releaseImages(results!);
    results!.replaceChildren();
    selected = -1;
    input!.removeAttribute('aria-activedescendant');
    if (!input!.value.trim()) {
      const recent = recentAnime();
      if (!recent.length) {
        close();
        return;
      }
      const label = document.createElement('p');
      label.className = 'search-scope';
      label.textContent = 'Недавно просмотрено';
      results!.append(label);
      recent.forEach((item, i) => {
        const link = document.createElement('a');
        link.href = item.href;
        const thumb = document.createElement('img');
        thumb.src = fallbackImages().poster;
        thumb.width = 40;
        thumb.height = 60;
        thumb.alt = '';
        thumb.decoding = 'async';
        thumb.loading = 'lazy';
        thumb.dataset.imageSrc = thumb.src;
        thumb.dataset.imageId = item.id.split(':')[1];
        thumb.dataset.imageTitle = item.title;
        thumb.dataset.imageFallback = url('assets/poster-placeholder.svg');
        const title = document.createElement('strong');
        title.textContent = item.title;
        link.append(thumb, title);
        link.id = `search-option-${i}`;
        link.setAttribute('role', 'option');
        link.setAttribute('aria-selected', 'false');
        results!.append(link);
      });
      input!.removeAttribute('aria-busy');
      results!.hidden = false;
      initImages(results!);
      input!.setAttribute('aria-expanded', 'true');
      return;
    }
    results!.textContent = 'Загрузка поискового индекса…';
    results!.hidden = false;
    input!.setAttribute('aria-expanded', 'true');
    input!.setAttribute('aria-busy', 'true');
    let response;
    try {
      response = await queryCatalog({ mode: 'search', query: input!.value, limit: 6 });
    } catch {
      if (current !== revision) return;
      input!.setAttribute('aria-invalid', 'true');
      input!.removeAttribute('aria-busy');
      results!.textContent = 'Не удалось загрузить поиск. Повторите ввод или обновите страницу.';
      return;
    }
    if (current !== revision) return;
    const images = await loadImages(response.entries.map((a) => a.shikimoriId));
    if (current !== revision) return;
    input!.removeAttribute('aria-invalid');
    input!.removeAttribute('aria-busy');
    results!.replaceChildren();
    const scope = document.createElement('p');
    scope.className = 'search-scope';
    scope.textContent = `Поиск по каталогу AniRezik · ${response.count} аниме`;
    results!.append(scope);
    const matches = response.entries;
    for (const [i, a] of matches.entries()) {
      const link = document.createElement('a');
      link.href = a.href;
      link.id = `search-option-${i}`;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', 'false');
      const image = document.createElement('img');
      image.src = (images[a.shikimoriId] || fallbackImages()).poster;
      image.width = 40;
      image.height = 60;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.addEventListener(
        'error',
        () => {
          image.src = url('assets/poster-placeholder.svg');
        },
        { once: true },
      );
      image.alt = '';
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = a.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = [a.originalTitle, a.year].filter(Boolean).join(' · ');
      text.append(title, subtitle);
      const art = document.createElement('span');
      art.className = 'search-poster';
      art.append(image);
      const rating = ratingBadge(a.score, true);
      if (rating) art.append(rating);
      link.append(art, text);
      results!.append(link);
    }
    if (!matches.length) {
      const message = document.createElement('p');
      message.textContent = 'Ничего не найдено в загруженном каталоге.';
      results!.append(message);
    }
    results!.hidden = false;
    input!.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', search);
  input.addEventListener('focus', () => {
    void search();
  });
  input.addEventListener('keydown', (event) => {
    const links = [...results.querySelectorAll<HTMLAnchorElement>('a[role="option"]')];
    if (event.key === 'Escape') {
      event.preventDefault(); // Prevent type=search native clearing from reopening recent views.
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!links.length) return;
      selected =
        event.key === 'ArrowDown'
          ? (selected + 1) % links.length
          : selected < 0
            ? links.length - 1
            : (selected - 1 + links.length) % links.length;
      links.forEach((link, i) => {
        link.classList.toggle('selected', i === selected);
        link.setAttribute('aria-selected', String(i === selected));
      });
      input.setAttribute('aria-activedescendant', links[selected].id);
      links[selected].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && (input.value.trim() || selected >= 0)) {
      event.preventDefault();
      if (selected >= 0 && links[selected]) location.href = links[selected].href;
      else
        location.href = `${input.dataset.catalogUrl}?q=${encodeURIComponent(input.value.trim())}`;
    }
  });
  document.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('.search-box,[data-open-search]')) close();
  });
  document.querySelector('[data-open-search]')?.addEventListener('click', () => {
    document.querySelector('.header')?.classList.toggle('search-open');
    input.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault();
      document.querySelector('.header')?.classList.add('search-open');
      input.focus({ preventScroll: true });
    }
  });
  input.disabled = false;
  if (input.value.trim()) search();
}
