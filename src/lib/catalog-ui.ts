import { queryCatalog } from './catalog-service';
import { loadImages } from './image-service';
import { renderCards } from './card-renderer';
export function initCatalog() {
  const grid = document.querySelector<HTMLElement>('#catalog-grid');
  if (!grid) return;
  const query = document.querySelector<HTMLInputElement>('#catalog-search')!;
  const names = ['genre', 'year', 'type', 'status', 'studio', 'sort'];
  const controls = names.map((name) =>
    document.querySelector<HTMLSelectElement>(`#filter-${name}`)!,
  );
  const params = new URLSearchParams(location.search);
  controls.forEach((control, i) => {
    if (params.has(names[i])) control.value = params.get(names[i])!;
    if (control.selectedIndex < 0) control.selectedIndex = 0;
  });
  query.value = params.get('q') || '';
  let limit = 24,
    revision = 0;
  const count = document.querySelector<HTMLElement>('.result-count')!;
  async function filter() {
    const current = ++revision;
    grid!.setAttribute('aria-busy', 'true');
    grid!.inert = true;
    count.textContent = 'Загрузка индекса каталога…';
    const filters = Object.fromEntries(controls.map((control, i) => [names[i], control.value]));
    const next = new URLSearchParams();
    controls.forEach((c, i) => {
      if (c.value && c.value !== 'default') next.set(names[i], c.value);
    });
    if (query.value.trim()) next.set('q', query.value.trim());
    history.replaceState(null, '', `${location.pathname}${next.size ? '?' + next : ''}`);
    try {
      const result = await queryCatalog({ mode: 'catalog', query: query.value, filters, limit });
      const images = await loadImages(result.entries.map((a) => a.shikimoriId));
      if (current !== revision) return;
      renderCards(grid!, result.entries, images);
      count.textContent = `Найдено: ${result.total} · Показано: ${result.entries.length}`;
      document.querySelector<HTMLElement>('#catalog-empty')!.hidden = result.total > 0;
      document.querySelector<HTMLElement>('#load-more')!.hidden = result.total <= limit;
    } catch {
      if (current !== revision) return;
      count.textContent =
        'Не удалось загрузить индекс. Сохранена предыдущая подборка. Повторите фильтр или обновите страницу.';
    } finally {
      if (current === revision) {
        grid!.removeAttribute('aria-busy');
        grid!.inert = false;
      }
    }
  }
  function reset() {
    controls.forEach((c) => (c.selectedIndex = 0));
    query.value = '';
    limit = 24;
    void filter();
  }
  controls.forEach((c) =>
    c.addEventListener('change', () => {
      limit = 24;
      void filter();
    }),
  );
  query.addEventListener('input', () => {
    limit = 24;
    void filter();
  });
  document.querySelector('#reset-filters')?.addEventListener('click', reset);
  document.querySelector('[data-reset]')?.addEventListener('click', reset);
  document.querySelector('#load-more')?.addEventListener('click', () => {
    limit += 24;
    void filter();
  });
  document.querySelector('.filter-toggle')?.addEventListener('click', () => {
    const open = document.querySelector('#filter-panel')!.classList.toggle('open');
    document.querySelector('.filter-toggle')!.setAttribute('aria-expanded', String(open));
  });
  // The first 24 cards are server-rendered; do not download the full index until needed.
  if (params.size) void filter();
}
