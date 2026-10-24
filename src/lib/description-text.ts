/** Preserve source wording, converting Shikimori BBCode into safe plain text. */
export function descriptionText(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/\\r\\n|\\n|\r\n?/g, '\n')
    .replace(/\[(?:img|video)(?:=[^\]]*)?\][\s\S]*?\[\/(?:img|video)\]/gi, '')
    .replace(/\[br\s*\/?\]|\[\/?(?:p|list)\]/gi, '\n')
    .replace(/\[\*\]/g, '\n• ')
    .replace(/\[spoiler(?:=[^\]]*)?\]/gi, '\nСпойлер:\n')
    .replace(
      /\[\/?(?:b|i|u|s|code|quote|center|left|right|color|size|url|anime|manga|ranobe|character|person|user|club|mention|entry|div|span|spoiler|spoiler_block|spoiler_inline|list|p|br|hr|align|font)(?:=[^\]]*)?\]/gi,
      '',
    )
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt);/g,
      (_, name: string) => ({ nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[name]!,
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
