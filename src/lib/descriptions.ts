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
