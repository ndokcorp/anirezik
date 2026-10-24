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
export function shareIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M8 12l8-5M8 12l8 5M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  );
  svg.append(path);
  return svg;
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
    let label = button.querySelector('span');
    if (!label) {
      label = document.createElement('span');
      label.textContent = 'Поделиться';
      button.replaceChildren(shareIcon(), label);
    }
    const address = location.href;
    try {
      await navigator.clipboard.writeText(address);
      label.textContent = 'Ссылка скопирована';
      setTimeout(() => {
        label!.textContent = 'Поделиться';
      }, 2500);
    } catch {
      const field = document.createElement('input');
      field.readOnly = true;
      field.value = address;
      field.setAttribute('aria-label', 'Ссылка на аниме — скопируйте вручную');
      button.after(field);
      field.focus({ preventScroll: true });
      field.select();
      label.textContent = 'Скопируйте ссылку ниже';
    }
  });
}
