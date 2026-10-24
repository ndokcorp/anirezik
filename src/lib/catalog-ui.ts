import { closeFilters, initFilterControls } from './filter-controls';
import { queryCatalog } from './catalog-service';
import { renderCards } from './card-renderer';
export function initCatalog() {
  const grid = document.querySelector<HTMLElement>('#catalog-grid');
  if (!grid) return;
  const query = document.querySelector<HTMLInputElement>('#catalog-search')!;
  const names = [
    'genre',
    'year',
    'type',
    'status',
    'studio',
    'sort',
    'theme',
    'minScore',
    'yearFrom',
    'yearTo',
  ];
  const controls = names.map((name) =>
    document.querySelector<HTMLSelectElement | HTMLInputElement>(`#filter-${name}`)!,
  );
  const params = new URLSearchParams(location.search);
  controls.forEach((control, i) => {
    if (params.has(names[i])) control.value = params.get(names[i])!;
    if (control instanceof HTMLSelectElement && control.selectedIndex < 0)
      control.selectedIndex = 0;
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
    if (filters.yearFrom === document.querySelector<HTMLInputElement>('#filter-yearFrom')!.min)
      delete filters.yearFrom;
    if (filters.yearTo === document.querySelector<HTMLInputElement>('#filter-yearTo')!.max)
      delete filters.yearTo;
    const next = new URLSearchParams();
    controls.forEach((c, i) => {
      if (
        c.value &&
        c.value !== 'default' &&
        !(c instanceof HTMLInputElement && c.value === (c.id.endsWith('From') ? c.min : c.max))
      )
        next.set(names[i], c.value);
    });
    if (query.value.trim()) next.set('q', query.value.trim());
    history.replaceState(null, '', `${location.pathname}${next.size ? '?' + next : ''}`);
    try {
      const result = await queryCatalog({ mode: 'catalog', query: query.value, filters, limit });
      if (current !== revision) return;
      renderCards(grid!, result.entries);
      count.textContent = `Найдено: ${result.total}`;
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
    controls.forEach((c) => {
      if (c instanceof HTMLSelectElement) c.selectedIndex = 0;
      else c.value = c.id.endsWith('From') ? c.min : c.max;
      c.dispatchEvent(new Event('filter-reset'));
    });
    syncYears();
    query.value = '';
    limit = 24;
    void filter();
  }
  function syncYears() {
    const from = document.querySelector<HTMLInputElement>('#filter-yearFrom')!;
    const to = document.querySelector<HTMLInputElement>('#filter-yearTo')!;
    document.querySelector('#year-from-label')!.textContent = from.value;
    document.querySelector('#year-to-label')!.textContent = to.value;
  }
  controls
    .filter((c) => c instanceof HTMLInputElement)
    .forEach((c) =>
      c.addEventListener('input', () => {
        const from = document.querySelector<HTMLInputElement>('#filter-yearFrom')!,
          to = document.querySelector<HTMLInputElement>('#filter-yearTo')!;
        if (Number(from.value) > Number(to.value)) {
          if (c === from) to.value = from.value;
          else from.value = to.value;
        }
        document.querySelector<HTMLSelectElement>('#filter-year')!.value = '';
        syncYears();
      }),
    );
  syncYears();
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
  const toggle = document.querySelector<HTMLButtonElement>('.filter-toggle');
  const dialog = document.querySelector<HTMLDialogElement>('#filter-panel')!;
  toggle?.addEventListener('click', () => {
    dialog.showModal();
    toggle.setAttribute('aria-expanded', 'true');
  });
  document
    .querySelector('[data-close-filters]')
    ?.addEventListener('click', () => closeFilters(dialog));
  dialog.addEventListener('close', () => toggle?.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        closeFilters(dialog);
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeFilters(dialog);
  });
  initFilterControls(dialog);
  if (toggle) toggle.disabled = false;
  // The first 24 cards are server-rendered; do not download the full index until needed.
  if (params.size) void filter();
}
