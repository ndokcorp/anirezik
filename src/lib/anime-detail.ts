import type { Anime, RelatedAnime } from '../types/anime';
import { element as el, favoriteButton, posterImage } from './card-renderer';
import { loadImages, fallbackImages } from './image-service';
import { initImages } from './image-client';
import { displayDate } from './dates';
import { url } from './paths';
type Detail = Anime & { related: (RelatedAnime & { href: string; external: boolean })[] };
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
    const banner = el('div', 'detail-banner');
    if (images.backdropUrl || images.posterUrl) {
      const img = el('img', images.backdropUrl ? '' : 'poster-backdrop');
      img.src = (images.backdropUrl || images.posterUrl)!;
      img.alt = '';
      img.width = 1600;
      img.height = 500;
      img.decoding = 'async';
      img.dataset.bannerImage = '';
      banner.append(img);
    } else banner.classList.add('neutral-banner');
    if (images.imageAttribution)
      banner.append(el('span', 'banner-attribution', images.imageAttribution));
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
      a.episodes === null ? 'Серии: —' : `${a.episodes} серий`,
    ])
      tags.append(el('span', '', String(value)));
    for (const genre of a.genres) {
      const link = el('a', '', genre);
      link.href = url(`catalog/?genre=${encodeURIComponent(genre)}`);
      tags.append(link);
    }
    copy.append(tags);
    copy.append(
      el(
        'p',
        'description',
        a.description ||
          'Редакционное описание пока не добавлено. Подробности доступны на странице источника.',
      ),
    );
    if (a.description) copy.append(el('p', 'source-note', 'Описание редакции AniRezik'));
    if (a.score) {
      const score = el('p', 'source-rating');
      score.append(
        externalLink(`★ ${a.score.toFixed(2)}/10 — оценка пользователей Shikimori ↗`, a.sourceUrl),
      );
      copy.append(score);
    }
    copy.append(favoriteButton(a.id, true));
    article.append(
      posterImage(
        { ...images, poster: images.posterDetailUrl || images.poster },
        a.title,
        'detail-poster',
      ),
      copy,
    );
    fragment.append(article);
    const info = panel('Информация об аниме'),
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
    const episodes = panel('Эпизоды'),
      counts = el('dl', 'anime-facts');
    fact(counts, 'Всего по данным источника', String(a.episodes ?? '—'));
    fact(counts, 'Вышло по данным источника', String(a.episodesAired ?? '—'));
    fact(counts, 'Статус', a.status);
    if (a.nextEpisodeAt) fact(counts, 'Следующий эпизод', displayDate(a.nextEpisodeAt));
    episodes.append(
      counts,
      el('p', '', 'Сведения об эфире из Shikimori, не количество доступных видео на AniRezik.'),
    );
    fragment.append(episodes);
    const watch = panel('Где посмотреть');
    watch.append(
      el(
        'p',
        '',
        'Разрешённые видеопровайдеры пока не подключены. Кнопки воспроизведения и выбора озвучки появятся, когда будут доступны проверенные источники для вашего региона.',
      ),
    );
    fragment.append(watch);
    if (a.related.length) {
      const section = panel('Связанные аниме и сезоны'),
        list = el('ul', 'related-list');
      for (const relation of a.related) {
        const row = el('li');
        const link = relation.external
          ? externalLink(`${relation.title} ↗ Shikimori`, relation.href)
          : el('a', '', relation.title);
        if (!relation.external) link.href = relation.href;
        link.setAttribute('aria-label', link.textContent || relation.title);
        link.classList.add('related-link');
        const label = el('span', 'related-copy', link.textContent || '');
        link.replaceChildren(label);
        if (!relation.external) {
          const img = posterImage(fallbackImages(), relation.title, 'related-poster', true);
          img.width = 48;
          img.height = 72;
          img.dataset.imageId = String(relation.shikimoriId);
          img.dataset.imageTitle = relation.title;
          img.dataset.imageCredit = 'inline';
          link.prepend(img);
        }
        row.append(el('span', '', relation.relation), link);
        list.append(row);
      }
      section.append(list);
      fragment.append(section);
    }
    container.replaceChildren(fragment);
    container.hidden = false;
    status.hidden = true;
    document.title = `${a.title} — AniRezik`;
    initImages(container);
    document.dispatchEvent(new Event('anirezik:cards-rendered'));
  } catch {
    status.textContent =
      'Не удалось загрузить данные аниме. Проверьте подключение и обновите страницу.';
  }
}
