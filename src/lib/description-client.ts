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
          if (
            value.id !== id ||
            typeof value.text !== 'string' ||
            !value.text.trim() ||
            value.text.length > 20000 ||
            typeof value.attribution !== 'string' ||
            !['en', 'ru'].includes(value.language) ||
            (value.sourceUrl !== null &&
              new URL(value.sourceUrl).origin !== 'https://www.tvmaze.com') ||
            (value.licenseUrl !== null &&
              value.licenseUrl !== 'https://creativecommons.org/licenses/by-sa/4.0/')
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
export function initDescriptions(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLParagraphElement>('.description[data-description-id]')
    .forEach((node) => {
      if (node.dataset.descriptionBound) return;
      node.dataset.descriptionBound = 'true';
      node.setAttribute('aria-busy', 'true');
      void loadDescription(Number(node.dataset.descriptionId)).then((record) => {
        node.removeAttribute('aria-busy');
        if (!record || !node.isConnected) return;
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
        node.after(credit);
      });
    });
}
