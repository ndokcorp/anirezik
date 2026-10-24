import { storedFavoriteIds, unresolvedLegacyCount } from './favorites';
import { loadFavoriteCards } from './card-packages';
import { renderCards } from './card-renderer';
export function initFavoritesPage() {
  const grid = document.querySelector<HTMLElement>('#favorites-grid');
  if (!grid) return;
  const list = document.querySelector<HTMLElement>('#favorites-list')!,
    empty = document.querySelector<HTMLElement>('#favorites-empty')!;
  const status = document.querySelector<HTMLElement>('#favorites-status')!,
    missing = document.querySelector<HTMLElement>('#favorites-unavailable')!;
  const more = document.querySelector<HTMLButtonElement>('#favorites-more')!;
  let limit = 24,
    revision = 0;
  async function render() {
    const current = ++revision,
      ids = storedFavoriteIds();
    list.hidden = !ids.length;
    empty.hidden = !!ids.length;
    status.textContent = ids.length ? 'Загрузка избранного…' : '';
    try {
      const result = await loadFavoriteCards(ids.slice(0, limit));
      if (current !== revision) return;
      renderCards(grid!, result.entries);
      const count = result.unavailable + unresolvedLegacyCount();
      missing.hidden = !count;
      missing.textContent = `Не найдены среди загруженных записей: ${count}. Все ID сохранены и появятся после импорта соответствующих аниме.`;
      status.textContent = '';
      more.hidden = ids.length <= limit;
      list.hidden = !result.entries.length && more.hidden;
      if (!result.entries.length && more.hidden) {
        list.hidden = true;
        empty.hidden = false;
      }
    } catch {
      if (current !== revision) return;
      status.textContent =
        'Не удалось загрузить избранное. Сохранённые записи не удалены. Обновите страницу.';
    }
  }
  document.addEventListener('anirezik:favorite-change', () => {
    void render();
  });
  more.addEventListener('click', () => {
    limit += 24;
    void render();
  });
  void render();
}
