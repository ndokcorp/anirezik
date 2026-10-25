import { storedFavoriteIds, unresolvedLegacyCount, FAVORITES_KEY } from './favorites';
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
import { libraryMenu } from './library-menu';
function listIcon(status: string) {
  const paths: Record<string, string> = {
    watching: 'm8 4 12 8-12 8z',
    completed: 'm5 12 4 4L19 6',
    planned: 'M6 3h12v18l-6-4-6 4z',
    rewatching: 'M3 11a9 9 0 1 1 2 7M3 3v8h8',
  };
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '20',
    height: '20',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'aria-hidden': 'true',
  }))
    icon.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[status]);
  icon.append(path);
  return icon;
}
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
    menu.id = `list-${id.replace(/\W/g, '-')}`;
    button.setAttribute('aria-controls', menu.id);
    const dropdown = libraryMenu(wrapper, button, menu);
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
      const text = document.createElement('span');
      text.className = 'list-label';
      text.textContent = label;
      item.append(listIcon(status), text);
      item.dataset.status = status;
      item.addEventListener('click', () => {
        if (setCollection(id, status as CollectionStatus)) {
          dropdown.close(true);
          sync();
          button.focus();
        } else {
          button.textContent = 'Хранение недоступно — повторить';
        }
      });
      menu.append(item);
    }
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
  const filter = root.querySelector<HTMLElement>('[data-collection-filter]');
  const dropdown = filter
    ? libraryMenu(filter, filter.querySelector('button')!, filter.querySelector('.list-options')!)
    : null;
  const list = new URLSearchParams(location.search).get('list');
  let selected: CollectionStatus | 'favorites' =
    list === 'favorites' || Object.hasOwn(collectionLabels, list || '')
      ? (list as CollectionStatus | 'favorites')
      : 'watching';
  async function render() {
    const current = ++revision;
    const saved = collection();
    const ids = isHistory
      ? historyIds()
      : selected === 'favorites'
        ? storedFavoriteIds()
        : Object.keys(saved).filter((id) => saved[id] === selected);
    const count = root!.querySelector<HTMLElement>('[data-library-count]');
    if (count) count.textContent = `Аниме в выбранном списке: ${ids.length}`;
    const filterLabel = root!.querySelector('[data-selected-list]');
    if (filterLabel)
      filterLabel.textContent =
        selected === 'favorites' ? 'Избранные аниме' : collectionLabels[selected];
    tabs.forEach((tab) =>
      tab.setAttribute('aria-pressed', String(tab.dataset.collectionStatus === selected)),
    );
    status.textContent = ids.length
      ? 'Загрузка…'
      : isHistory
        ? 'В этом списке пока нет аниме.'
        : '';
    renderCards(grid, []);
    more.hidden = ids.length <= limit;
    try {
      const result = await loadFavoriteCards(ids.slice(0, limit));
      if (current !== revision) return;
      renderCards(grid, result.entries);
      if (!isHistory && selected !== 'favorites')
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
      const unavailable =
        result.unavailable + (selected === 'favorites' ? unresolvedLegacyCount() : 0);
      status.textContent = unavailable
        ? `Некоторые записи недоступны: ${unavailable}. Список сохранён.`
        : ids.length
          ? ''
          : isHistory
            ? 'В этом списке пока нет аниме.'
            : '';
    } catch {
      if (current === revision)
        status.textContent = 'Не удалось загрузить карточки. Список сохранён. Повторите попытку.';
    }
  }
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      selected = tab.dataset.collectionStatus as CollectionStatus | 'favorites';
      history.replaceState(null, '', `${location.pathname}?list=${selected}`);
      limit = 24;
      dropdown?.close(true);
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
    if (
      event.key === COLLECTION_KEY ||
      event.key === HISTORY_KEY ||
      event.key === FAVORITES_KEY ||
      event.key === null
    )
      void render();
  });
  document.addEventListener('anirezik:library-change', () => void render());
  document.addEventListener('anirezik:favorite-change', () => {
    if (selected === 'favorites') void render();
  });
  void render();
}
export function initPosterInteraction() {
  const isPoster = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest('.detail-poster,.hero-poster,.anime-card,.chronology-card');
  document.addEventListener('contextmenu', (event) => {
    if (isPoster(event.target)) event.preventDefault();
  });
  document.addEventListener('dragstart', (event) => {
    if (isPoster(event.target)) event.preventDefault();
  });
}
