import { enhanceDetailMeta } from './detail-meta';
import { initListPicker } from './library-ui';
import { initSurfaceControls } from './surface-controls';
import { rememberAnime, shareIcon } from './recent-anime';
import { ageLabel } from './card-meta';
import { loadFavoriteCards } from './card-packages';
import { renderCards } from './card-renderer';
import type { Anime, RelatedAnime } from '../types/anime';
import { element as el, favoriteButton, posterImage } from './card-renderer';
import { loadImages, fallbackImages } from './image-service';
import { initImages } from './image-client';
import { displayDate } from './dates';
import { url } from './paths';
import { ratingBadge } from './rating';
import { initDescriptions } from './description-client';
type Detail = Anime & {
  hasDescription?: boolean;
  chronology?: {
    id: string;
    shikimoriId: number;
    year: number | null;
    score?: number | null;
    title: string;
    href: string;
    date: string | null;
    type: string;
    current: boolean;
  }[];
  similarIds?: string[];
  related: (RelatedAnime & { href: string; external: boolean; score: number | null })[];
};
function externalLink(text: string, href: string) {
  const link = el('a', '', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function panel(title: string) {
  const section = el('section', 'info-panel');
  section.append(el('h2', '', title));
  return section;
}
export async function initAnimeDetail() {
  const container = document.querySelector<HTMLElement>('#anime-detail'),
    status = document.querySelector<HTMLElement>('#anime-status');
  if (!container || !status) return;
  const id = new URLSearchParams(location.search).get('id');
  if (!id || !/^\d{1,9}$/.test(id) || Number(id) < 1) {
    status.textContent = 'Укажите корректный Shikimori ID. Аниме не загружено.';
    return;
  }
  try {
    const response = await fetch(url(`data/anime/${Number(id)}.json`), {
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) {
      status.textContent = 'Это аниме отсутствует в импортированном каталоге.';
      return;
    }
    if (!response.ok) throw new Error('fetch');
    const a = (await response.json()) as Detail;
    if (
      a.shikimoriId !== Number(id) ||
      typeof a.title !== 'string' ||
      !Array.isArray(a.genres) ||
      !Array.isArray(a.related)
    )
      throw new Error('schema');
    const images = (await loadImages([a.shikimoriId]))[a.shikimoriId] || fallbackImages();
    const fragment = document.createDocumentFragment();
    const banner = el('div', 'detail-banner neutral-banner');
    banner.setAttribute('aria-hidden', 'true');
    fragment.append(banner);
    const article = el('article', 'detail-content'),
      copy = el('div', 'detail-copy');
    copy.append(
      el('span', 'eyebrow', 'ANIREZIK / КАТАЛОГ'),
      el('h1', '', a.title),
      el('p', 'original-title', a.originalTitle),
    );
    const tags = el('div', 'detail-tags');
    for (const value of [
      a.year ?? '—',
      a.type,
      a.status,
      ageLabel(a.ageRating),
      a.episodes === null ? 'Серии: —' : `${a.episodes} серий`,
    ])
      if (value !== null) tags.append(el('span', '', String(value)));
    for (const genre of a.genres) {
      const link = el('a', '', genre);
      link.href = url(`catalog/?genre=${encodeURIComponent(genre)}`);
      tags.append(link);
    }
    copy.append(tags);
    const description = el('p', 'description', a.description || 'Описание пока недоступно.');
    if (a.hasDescription) description.dataset.descriptionId = String(a.shikimoriId);
    copy.append(description);
    if (a.description) {
      const credit = el('p', 'source-note', 'Описание редакции AniRezik');
      credit.dataset.editorialCredit = '';
      copy.append(credit);
    }
    if (!a.description) {
      const source = externalLink('Описание на Shikimori ↗', a.sourceUrl);
      source.className = 'source-note';
      source.dataset.descriptionFallback = '';
      copy.append(source);
    }
    const jump = el('a', 'button button-primary player-jump', 'СМОТРЕТЬ');
    jump.href = '#anime-player';
    copy.append(jump);
    const sidebar = el('aside', 'detail-sidebar'),
      actions = el('div', 'detail-actions');
    const share = el('button', 'button button-secondary');
    share.append(shareIcon(), el('span', '', 'Поделиться'));
    share.dataset.shareAnime = '';
    actions.append(favoriteButton(a.id, true), share);
    const posterWrap = el('div', 'detail-poster-wrap');
    posterWrap.append(
      posterImage(
        { ...images, poster: images.posterDetailUrl || images.poster },
        a.title,
        'detail-poster',
      ),
    );
    const score = ratingBadge(a.score);
    if (score) {
      const badge = el('div', 'poster-rating');
      badge.append(score);
      posterWrap.append(badge);
    }
    sidebar.append(posterWrap, actions);
    article.append(sidebar, copy);
    fragment.append(article);
    const info = panel('Сведения об аниме'),
      facts = el('dl', 'anime-facts');
    function fact(list: HTMLElement, label: string, value: string | Node) {
      const row = el('div');
      row.append(el('dt', '', label));
      const dd = el('dd');
      dd.append(value);
      row.append(dd);
      list.append(row);
    }
    fact(facts, 'Оригинальное название', a.originalTitle);
    if (a.englishTitle) fact(facts, 'Английское название', a.englishTitle);
    if (a.japaneseTitle) fact(facts, 'Японское название', a.japaneseTitle);
    const studios = el('span');
    for (const studio of a.studios) {
      const link = el('a', '', studio);
      link.href = url(`catalog/?studio=${encodeURIComponent(studio)}`);
      studios.append(link);
    }
    fact(facts, 'Студии анимации', a.studios.length ? studios : '—');
    fact(facts, 'Возрастная классификация', a.ageRating ?? '—');
    fact(facts, 'Продолжительность эпизода', a.duration ? `${a.duration} мин` : '—');
    fact(facts, 'Начало показа', displayDate(a.airedOn));
    fact(facts, 'Окончание показа', displayDate(a.releasedOn));
    if (a.themes.length) fact(facts, 'Тематики и аудитория', a.themes.join(', '));
    info.append(facts);
    const note = el('p', 'source-note', `Данные обновлены ${displayDate(a.fetchedAt)} · `);
    note.append(externalLink('Открыть на Shikimori ↗', a.sourceUrl));
    info.append(note);
    fragment.append(info);
    const counts = facts;
    fact(counts, 'Всего по данным источника', String(a.episodes ?? '—'));
    fact(counts, 'Вышло по данным источника', String(a.episodesAired ?? '—'));
    fact(counts, 'Статус', a.status);
    if (a.nextEpisodeAt) fact(counts, 'Следующий эпизод', displayDate(a.nextEpisodeAt));
    const watch = panel(a.title);
    watch.id = 'anime-player';
    watch.dataset.playerMeta = JSON.stringify({
      title: a.title,
      originalTitle: a.originalTitle,
      englishTitle: a.englishTitle,
      aliases: a.aliases,
      year: a.year,
      type: a.kind || a.type,
    });
    watch.classList.add('player-section');
    const placeholder = el('div', 'player-placeholder');
    placeholder.append(el('strong', '', a.title), el('p', '', 'Подключаем доступные источники…'));
    watch.append(placeholder);
    fragment.append(watch);
    void import('./video-player').then(({ loadPlayerSources }) => loadPlayerSources(watch, a.id));
    if (a.chronology && a.chronology.length > 1) {
      const timeline = panel('Хронология франшизы'),
        list = el('ol', 'franchise-track');
      timeline.classList.add('chronology-section');
      const heading = el('div', 'chronology-heading');
      heading.append(timeline.firstElementChild!, el('span', '', `${a.chronology.length} аниме`));
      timeline.prepend(heading);
      for (const [index, item] of a.chronology.entries()) {
        const row = el('li', item.current ? 'current' : '');
        const link = el('a', 'chronology-card');
        link.href = item.href;
        if (item.current) link.setAttribute('aria-current', 'page');
        const img = posterImage(fallbackImages(), item.title, '', true);
        img.dataset.imageId = String(item.shikimoriId || Number(item.id.split(':')[1]));
        img.dataset.imageTitle = item.title;
        const art = el('span', 'chronology-art');
        art.append(img);
        const chronologyRating = ratingBadge(item.score ?? null, true);
        if (chronologyRating) art.append(chronologyRating);
        link.append(
          art,
          el('strong', '', item.title),
          el('small', '', `${item.year ?? '—'} · ${item.type}`),
        );
        const step = el('span', 'chronology-step', String(index + 1));
        step.setAttribute('aria-hidden', 'true');
        row.append(
          el('span', 'chronology-year', item.current ? 'ВЫ ЗДЕСЬ' : String(item.year ?? '—')),
          step,
          link,
        );
        list.append(row);
      }
      timeline.append(list);
      fragment.append(timeline);
    }
    let similarGrid: HTMLElement | undefined;
    let similarSection: HTMLElement | undefined;
    if (a.similarIds?.length) {
      similarSection = panel('Похожие аниме');
      similarSection.id = 'similar-anime';
      similarGrid = el('div', 'anime-grid');
      similarSection.append(
        el('p', 'section-subtitle', 'Схожие аниме по жанрам в каталоге'),
        similarGrid,
      );
      fragment.append(similarSection);
    }
    const comments = panel('Комментарии');
    comments.append(el('p', '', 'Обсуждения появятся в одной из следующих версий.'));
    fragment.append(comments);
    container.replaceChildren(fragment);
    rememberAnime({ id: a.id, title: a.title, href: location.pathname + location.search });
    if (similarGrid && similarSection) {
      const grid = similarGrid,
        section = similarSection;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          void loadFavoriteCards(a.similarIds!)
            .then((result) => {
              if (grid.isConnected) renderCards(grid, result.entries);
            })
            .catch(() => {
              grid.textContent = 'Не удалось загрузить похожие аниме.';
            });
        },
        { rootMargin: '160px' },
      );
      observer.observe(section);
    }
    container.hidden = false;
    status.hidden = true;
    document.title = `${a.title} — AniRezik`;
    initImages(container);
    initDescriptions(container);
    initSurfaceControls(container);
    initListPicker(container);
    enhanceDetailMeta(container);
    document.dispatchEvent(new Event('anirezik:cards-rendered'));
  } catch {
    status.textContent =
      'Не удалось загрузить данные аниме. Проверьте подключение и обновите страницу.';
  }
}
