import { url } from './paths';
const key = 'anirezik:recent:v1';
type Recent = { id: string; title: string; href: string };
export function recentAnime(): Recent[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (v): v is Recent =>
          !!v &&
          typeof v === 'object' &&
          /^shikimori:\d+$/.test(v.id) &&
          typeof v.title === 'string' &&
          v.title.length <= 500 &&
          typeof v.href === 'string' &&
          v.href.startsWith(url('anime/')) &&
          !v.href.includes('\\'),
      )
      .slice(0, 3);
  } catch {
    return [];
  }
}
export function rememberAnime(item: Recent) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify([item, ...recentAnime().filter((v) => v.id !== item.id)].slice(0, 3)),
    );
  } catch {
    /* Storage may be disabled. */
  }
}
export function initDetailActions() {
  const node = document.querySelector<HTMLElement>('[data-viewed-id]');
  if (node?.dataset.viewedId && node.dataset.viewedTitle)
    rememberAnime({
      id: node.dataset.viewedId,
      title: node.dataset.viewedTitle,
      href: location.pathname + location.search,
    });
  document.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-share-anime]');
    if (!button) return;
    const address = location.href;
    try {
      await navigator.clipboard.writeText(address);
      button.textContent = 'Ссылка скопирована';
      setTimeout(() => {
        button.textContent = 'Поделиться';
      }, 2500);
    } catch {
      const field = document.createElement('input');
      field.readOnly = true;
      field.value = address;
      field.setAttribute('aria-label', 'Ссылка на аниме — скопируйте вручную');
      button.after(field);
      field.focus({ preventScroll: true });
      field.select();
      button.textContent = 'Скопируйте ссылку ниже';
    }
  });
}
