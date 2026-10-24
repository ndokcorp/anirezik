import sources from '../data/description-sources.json';
import { url } from './paths';
import type { DescriptionRecord } from './descriptions';
const loaded = new Map<number, Promise<DescriptionRecord | null>>();
export function loadDescription(id: number): Promise<DescriptionRecord | null> {
  if (!Number.isSafeInteger(id) || id < 1) return Promise.resolve(null);
  if (!loaded.has(id))
    loaded.set(
      id,
      fetch(url(`data/descriptions/${id}.json`), { signal: AbortSignal.timeout(15000) })
        .then(async (response) => {
          if (!response.ok) throw new Error('description unavailable');
          const value = (await response.json()) as DescriptionRecord;
          const origin = value.sourceUrl === null ? null : new URL(value.sourceUrl).origin;
          const allowedSource =
            origin === null
              ? value.licenseUrl === null
              : origin === 'https://www.tvmaze.com'
                ? sources.tvmaze.status === 'permission-granted' &&
                  !!sources.tvmaze.evidence &&
                  value.licenseUrl === 'https://creativecommons.org/licenses/by-sa/4.0/'
                : origin === 'https://shikimori.io' &&
                  sources.shikimori.status === 'permission-granted' &&
                  !!sources.shikimori.evidence &&
                  value.sourceUrl === `https://shikimori.io/animes/${id}` &&
                  value.licenseUrl === null;
          if (
            value.id !== id ||
            typeof value.text !== 'string' ||
            !value.text.trim() ||
            value.text.length > 20000 ||
            typeof value.attribution !== 'string' ||
            !['en', 'ru'].includes(value.language) ||
            !allowedSource
          )
            throw new Error('invalid description');
          return value;
        })
        .catch(() => {
          loaded.delete(id);
          return null;
        }),
    );
  return loaded.get(id)!;
}
function expandDescription(node: HTMLParagraphElement) {
  if (node.textContent!.length < 420 || node.dataset.expandBound) return;
  node.dataset.expandBound = 'true';
  node.classList.add('description-collapsed');
  node.style.maxHeight = '7.8em';
  if (!node.id) node.id = `description-${node.dataset.descriptionId || 'editorial'}`;
  const button = document.createElement('button');
  button.className = 'description-toggle';
  button.textContent = 'Развернуть описание';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', node.id);
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    node.style.maxHeight = `${node.getBoundingClientRect().height}px`;
    node.classList.toggle('description-collapsed', expanded);
    const collapsed = expanded;
    requestAnimationFrame(() => {
      node.style.maxHeight = collapsed ? '7.8em' : `${node.scrollHeight}px`;
    });
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? 'Развернуть описание' : 'Свернуть описание';
  });
  node.after(button);
}
export function initDescriptions(root: ParentNode = document) {
  root.querySelectorAll<HTMLParagraphElement>('.description').forEach(expandDescription);
  root
    .querySelectorAll<HTMLParagraphElement>('.description[data-description-id]')
    .forEach((node) => {
      if (node.dataset.descriptionBound) return;
      node.dataset.descriptionBound = 'true';
      node.setAttribute('aria-busy', 'true');
      void loadDescription(Number(node.dataset.descriptionId)).then((record) => {
        node.removeAttribute('aria-busy');
        if (!node.isConnected) return;
        if (!record) {
          const retry = document.createElement('button');
          retry.className = 'description-toggle';
          retry.textContent = 'Повторить загрузку описания';
          retry.addEventListener('click', () => {
            retry.remove();
            delete node.dataset.descriptionBound;
            initDescriptions(root);
          });
          node.after(retry);
          return;
        }
        const previousToggle = node.parentElement?.querySelector<HTMLButtonElement>(
          `button.description-toggle[aria-controls="${node.id}"]`,
        );
        const wasExpanded = previousToggle?.getAttribute('aria-expanded') === 'true';
        previousToggle?.remove();
        delete node.dataset.expandBound;
        node.classList.remove('description-collapsed');
        node.style.maxHeight = '';
        node.parentElement
          ?.querySelectorAll('[data-description-fallback]')
          .forEach((link) => link.remove());
        node.textContent = record.text;
        node.lang = record.language;
        const credit = document.createElement('p');
        credit.className = 'source-note description-credit';
        if (record.sourceUrl) {
          const source = document.createElement('a');
          source.href = record.sourceUrl;
          source.textContent = record.attribution;
          source.target = '_blank';
          source.rel = 'noopener noreferrer';
          credit.append(source);
        } else credit.textContent = record.attribution;
        if (record.licenseUrl) {
          const license = document.createElement('a');
          license.href = record.licenseUrl;
          license.textContent = 'CC BY-SA 4.0';
          license.target = '_blank';
          license.rel = 'noopener noreferrer';
          credit.append(' · ', license, ' · HTML-форматирование удалено, текст не переведён.');
        }
        node.parentElement
          ?.querySelectorAll('[data-editorial-credit]')
          .forEach((credit) => credit.remove());
        if (!record.sourceUrl?.startsWith('https://shikimori.io/')) node.after(credit);
        expandDescription(node);
        if (wasExpanded)
          node.parentElement
            ?.querySelector<HTMLButtonElement>(
              `button.description-toggle[aria-controls="${node.id}"]`,
            )
            ?.click();
      });
    });
}
