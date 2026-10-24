import { enhanceDetailMeta } from './detail-meta';
import { initListPicker, initLibraryPage, initPosterInteraction } from './library-ui';
import { initSurfaceControls, bindNews } from './surface-controls';
import { initNavigationMotion } from './navigation-motion';
import { initDetailActions } from './recent-anime';
import { initImages } from './image-client';
import { initDescriptions } from './description-client';
import { storedFavoriteIds, writeFavorites, FAVORITES_KEY } from './favorites';
import { initSearch } from './search-ui';
import { initCatalog } from './catalog-ui';
import { initFavoritesPage } from './favorites-ui';
const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
];
function initFavorites() {
  let favorites = storedFavoriteIds();
  let toastTimer: ReturnType<typeof setTimeout>;
  function toast(message: string) {
    const node = $('.toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('visible'), 2600);
  }
  function syncFavorites() {
    $$<HTMLButtonElement>('[data-favorite]').forEach((button) => {
      const saved = favorites.includes(button.dataset.favorite!);
      button.setAttribute('aria-pressed', String(saved));
      button.disabled = false;
      button.setAttribute('aria-label', saved ? 'Удалить из избранного' : 'Добавить в избранное');
      const span = button.querySelector('span');
      if (span) span.textContent = saved ? 'В избранном' : 'В избранное';
    });
  }
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-favorite]');
    if (!button) return;
    const id = button.dataset.favorite!;
    favorites = storedFavoriteIds();
    const saved = favorites.includes(id),
      next = saved ? favorites.filter((v) => v !== id) : [...favorites, id];
    if (writeFavorites(next, [...favorites, id])) {
      favorites = next;
      syncFavorites();
      document.dispatchEvent(new Event('anirezik:favorite-change'));
      toast(saved ? 'Удалено из избранного' : 'Добавлено в вашу коллекцию');
    } else toast('Браузер не разрешает сохранить избранное. Проверьте настройки хранения.');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === FAVORITES_KEY || event.key === null) {
      favorites = storedFavoriteIds();
      syncFavorites();
      document.dispatchEvent(new Event('anirezik:favorite-change'));
    }
  });
  document.addEventListener('anirezik:cards-rendered', syncFavorites);
  syncFavorites();
}
initFavorites();
initDetailActions();
initListPicker();
enhanceDetailMeta();
initLibraryPage();
initPosterInteraction();
initNavigationMotion();
initSurfaceControls();
bindNews();
initSearch();
initFavoritesPage();

initImages();
initDescriptions();

const menu = $<HTMLDialogElement>('#mobile-menu');
const menuButton = $('.menu-toggle');
menuButton?.addEventListener('click', () => {
  menu?.showModal();
  menuButton.setAttribute('aria-expanded', 'true');
});
$('[data-close-menu]')?.addEventListener('click', () => menu?.close());
menu?.addEventListener('close', () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  (menuButton as HTMLButtonElement)?.focus();
});
menu?.addEventListener('click', (event) => {
  if (event.target === menu) {
    const rect = menu.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      menu.close();
  }
});

const slides = $$('[data-slide]');
let slideIndex = 0;
function setSlide(index: number) {
  slideIndex = (index + slides.length) % slides.length;
  slides[slideIndex]
    ?.querySelectorAll<HTMLImageElement>('img[data-slide-image-src]')
    .forEach((image) => {
      image.src = image.dataset.slideImageSrc!;
      delete image.dataset.slideImageSrc;
    });
  slides.forEach((slide, i) => {
    slide.classList.toggle('selected', i === slideIndex);
    slide.setAttribute('aria-hidden', String(i !== slideIndex));
    slide.inert = i !== slideIndex;
  });
  $$<HTMLButtonElement>('[data-slide-to]').forEach((button, i) => {
    button.classList.toggle('active', i === slideIndex);
    button.setAttribute('aria-pressed', String(i === slideIndex));
  });
  const count = $('[data-current-slide]');
  if (count) count.textContent = String(slideIndex + 1).padStart(2, '0');
}
$$<HTMLButtonElement>('[data-slide-to]').forEach((button) =>
  button.addEventListener('click', () => setSlide(Number(button.dataset.slideTo))),
);
$('[data-prev-slide]')?.addEventListener('click', () => setSlide(slideIndex - 1));
$('[data-next-slide]')?.addEventListener('click', () => setSlide(slideIndex + 1));
const hero = $('.hero');
let touchX = 0;
hero?.addEventListener(
  'touchstart',
  (e) => (touchX = (e as TouchEvent).changedTouches[0].clientX),
  { passive: true },
);
hero?.addEventListener(
  'touchend',
  (e) => {
    const dx = (e as TouchEvent).changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 45) setSlide(slideIndex + (dx < 0 ? 1 : -1));
  },
  { passive: true },
);
hero?.addEventListener('keydown', (event) => {
  const e = event as KeyboardEvent;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    setSlide(slideIndex + (e.key === 'ArrowRight' ? 1 : -1));
  }
});

const homeSections = $$('.anime-section').map((section) => ({
  section,
  cards: [...section.querySelectorAll<HTMLElement>('[data-anime-id]')],
}));
$$<HTMLButtonElement>('[data-genre]').forEach((button) =>
  button.addEventListener('click', () => {
    const genre = button.dataset.genre!;
    $$('[data-genre]').forEach((b) => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    homeSections.forEach(({ section, cards }) => {
      cards.forEach(
        (card) => (card.hidden = !!genre && !card.dataset.genres?.split('|').includes(genre)),
      );
      // Put matches into the visible mobile slots; CSS limits the section to four cards.
      const grid = section.querySelector('.anime-grid');
      [...cards.filter((card) => !card.hidden), ...cards.filter((card) => card.hidden)].forEach(
        (card) => grid?.append(card),
      );
      const empty = section.querySelector<HTMLElement>('.empty-inline');
      if (empty) empty.hidden = cards.some((card) => !card.hidden);
    });
  }),
);

initCatalog();
