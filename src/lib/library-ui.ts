import {
  collection,
  collectionLabels,
  setCollection,
  removeCollection,
  historyIds,
  COLLECTION_KEY,
  HISTORY_KEY,
} from './local-library';
import type { CollectionStatus } from './local-library';
import { loadFavoriteCards } from './card-packages';
import { renderCards } from './card-renderer';
export function initListPicker(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.detail-actions').forEach((actions) => {
    if (actions.querySelector('.list-picker')) return;
    const id = actions.querySelector<HTMLElement>('[data-favorite]')?.dataset.favorite;
    if (!id) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'list-picker';
    const button = document.createElement('button');
    button.className = 'button button-secondary';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'list-options';
    menu.hidden = true;
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Добавить в список');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-secondary collection-remove';
    remove.textContent = 'Удалить из коллекции';
    remove.addEventListener('click', () => {
      if (!removeCollection(id)) button.textContent = 'Не удалось удалить — повторите';
    });
    const sync = () => {
      const status = collection()[id];
      remove.hidden = !status;
      button.textContent = '☷ ' + (status ? collectionLabels[status] : 'Добавить в список');
      menu
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((item) =>
          item.setAttribute('aria-pressed', String(item.dataset.status === status)),
        );
    };
    for (const [status, label] of Object.entries(collectionLabels)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = label;
      item.dataset.status = status;
      item.addEventListener('click', () => {
        if (setCollection(id, status as CollectionStatus)) {
          menu.hidden = true;
          button.setAttribute('aria-expanded', 'false');
          sync();
          button.focus();
        } else {
          button.textContent = 'Хранение недоступно — повторить';
        }
      });
      menu.append(item);
    }
    button.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!wrapper.contains(event.target as Node)) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    window.addEventListener('storage', sync);
    document.addEventListener('anirezik:library-change', sync);
    wrapper.append(button, menu);
    actions.prepend(wrapper, remove);
    sync();
  });
}
export function initLibraryPage() {
  const root = document.querySelector<HTMLElement>('[data-library-page]');
  if (!root) return;
  const isHistory = root.dataset.libraryPage === 'history';
  let limit = 24,
    revision = 0;
  const status = root.querySelector<HTMLElement>('[data-library-status]')!,
    grid = root.querySelector<HTMLElement>('.anime-grid')!,
    more = root.querySelector<HTMLButtonElement>('[data-library-more]')!;
  const tabs = root.querySelectorAll<HTMLButtonElement>('[data-collection-status]');
  let selected: CollectionStatus = 'watching';
  async function render() {
    const current = ++revision;
    const saved = collection();
    const ids = isHistory
      ? historyIds()
      : Object.keys(saved).filter((id) => saved[id] === selected);
    tabs.forEach((tab) =>
      tab.setAttribute('aria-pressed', String(tab.dataset.collectionStatus === selected)),
    );
    status.textContent = ids.length ? 'Загрузка…' : 'В этом списке пока нет аниме.';
    more.hidden = ids.length <= limit;
    try {
      const result = await loadFavoriteCards(ids.slice(0, limit));
      if (current !== revision) return;
      renderCards(grid, result.entries);
      if (!isHistory)
        grid.querySelectorAll<HTMLElement>('[data-anime-id]').forEach((card) => {
          const entry = document.createElement('div');
          entry.className = 'collection-entry';
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'button button-secondary collection-remove';
          remove.textContent = 'Удалить';
          const id = card.dataset.animeId!;
          remove.setAttribute(
            'aria-label',
            `Удалить из коллекции: ${result.entries.find((item) => item.id === id)?.title || id}`,
          );
          remove.addEventListener('click', () => {
            if (!removeCollection(id))
              status.textContent = 'Не удалось удалить. Проверьте настройки хранения.';
          });
          card.replaceWith(entry);
          entry.append(card, remove);
        });
      status.textContent = result.unavailable
        ? `Некоторые записи недоступны: ${result.unavailable}. Список сохранён.`
        : ids.length
          ? ''
          : 'В этом списке пока нет аниме.';
    } catch {
      if (current === revision)
        status.textContent = 'Не удалось загрузить карточки. Список сохранён. Повторите попытку.';
    }
  }
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      selected = tab.dataset.collectionStatus as CollectionStatus;
      limit = 24;
      void render();
    }),
  );
  more.addEventListener('click', () => {
    limit += 24;
    void render();
  });
  root.querySelector('[data-library-retry]')?.addEventListener('click', () => void render());
  root.querySelector('[data-clear-history]')?.addEventListener('click', () => {
    try {
      localStorage.setItem(HISTORY_KEY, '[]');
      void render();
    } catch {
      status.textContent = 'Браузер не разрешает изменить историю.';
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === COLLECTION_KEY || event.key === HISTORY_KEY || event.key === null)
      void render();
  });
  document.addEventListener('anirezik:library-change', () => void render());
  void render();
}
export function initPosterInteraction() {
  const isPoster = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('.detail-poster,.anime-card,.chronology-card');
  document.addEventListener('contextmenu', (event) => {
    if (isPoster(event.target)) event.preventDefault();
  });
  document.addEventListener('dragstart', (event) => {
    if (isPoster(event.target)) event.preventDefault();
  });
}
