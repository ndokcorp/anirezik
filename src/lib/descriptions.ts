import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Build-time only: licensed text is emitted as individual detail-only JSON files.
import editorial from '../data/editorial.json' with { type: 'json' };
import imported from '../data/licensed-descriptions.json' with { type: 'json' };
import sources from '../data/description-sources.json' with { type: 'json' };
export interface DescriptionRecord {
  id: number;
  text: string;
  attribution: string;
  sourceUrl: string | null;
  licenseUrl: string | null;
  language: string;
  changes?: string;
  source?: string;
}
export const descriptions = new Map<number, DescriptionRecord>();
if (sources.tvmaze.status === 'permission-granted' && sources.tvmaze.evidence) {
  for (const [id, value] of Object.entries(imported)) {
    if (
      !/^\d+$/.test(id) ||
      !value.text.trim() ||
      value.text.length > 20000 ||
      new URL(value.sourceUrl).origin !== 'https://www.tvmaze.com'
    )
      continue;
    descriptions.set(Number(id), {
      id: Number(id),
      text: value.text,
      attribution: value.attribution,
      sourceUrl: value.sourceUrl,
      licenseUrl: sources.tvmaze.licenseUrl,
      language: value.language,
    });
  }
}
for (const [id, value] of Object.entries(editorial)) {
  if (value.description.trim())
    descriptions.set(Number(id), {
      id: Number(id),
      text: value.description,
      attribution: 'Описание редакции AniRezik',
      sourceUrl: null,
      licenseUrl: null,
      language: 'ru',
    });
}

// The large imported text snapshot is build-only, never bundled into client code.
if (sources.shikimori.status === 'permission-granted' && sources.shikimori.evidence) {
  const importedShikimori = JSON.parse(
    readFileSync(resolve('src/data/shikimori-descriptions.json'), 'utf8'),
  ) as Record<string, { text: string; sourceUrl: string; fetchedAt: string }>;
  for (const [id, record] of Object.entries(importedShikimori)) {
    if (
      !/^\d+$/.test(id) ||
      typeof record.text !== 'string' ||
      !record.text.trim() ||
      record.text.length > 20000 ||
      record.sourceUrl !== `https://shikimori.io/animes/${Number(id)}`
    )
      continue;
    descriptions.set(Number(id), {
      id: Number(id),
      text: record.text,
      attribution: sources.shikimori.attribution,
      sourceUrl: record.sourceUrl,
      licenseUrl: null,
      language: /[а-яё]/i.test(record.text) ? 'ru' : 'en',
      source: 'Shikimori',
      changes: 'BBCode преобразован в обычный текст.',
    });
  }
}
