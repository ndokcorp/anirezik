/** Shared conservative title keys. Loose/transliterated matches are proposals only. */
const roman: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};
const ordinal: Record<string, string> = {
  первый: '1',
  второй: '2',
  третий: '3',
  четвертый: '4',
  пятый: '5',
  шестой: '6',
  седьмой: '7',
  восьмой: '8',
  девятый: '9',
  десятый: '10',
};
export function animeTitleKey(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\b/g, (x) => roman[x])
      .replace(
        /(первый|второй|третий|четвертый|пятый|шестой|седьмой|восьмой|девятый|десятый)\s+сезон/gu,
        (_, x) => ordinal[x],
      )
      .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, '$1')
      .replace(/(?:\bseason\s*|сезон\s*)(\d+)/gu, '$1')
      // Part is intentionally retained, unlike punctuation. 3 != 3 Part 2.
      .replace(/часть\s*(\d+)/gu, 'part $1')
      .replace(/[^\p{L}\p{N}]/gu, '')
  );
}
export function confirmedSlug(
  url?: string,
  origins: readonly string[] = [],
  releaseId?: number,
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || !origins.includes(u.origin))
      return null;
    const leaf = decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1) || '');
    if (releaseId && !leaf.startsWith(`${releaseId}-`)) return null;
    return leaf.replace(/^\d+-/, '').replace(/\.html?$/i, '');
  } catch {
    return null;
  }
}
export interface TitleIdentity {
  shikimoriId?: number;
  malId?: number;
  title: string;
  originalTitle?: string;
  englishTitle?: string | null;
  aliases?: string[];
  year: number | null;
  kind: string;
  episodes?: number | null;
}
export interface SupplierIdentity {
  officialAlias?: string;
  releaseId?: number;
  shikimoriId?: number | null;
  malId?: number | null;
  names: string[];
  year: number | null;
  kind: string;
  episodeNumbers: number[];
  url?: string;
}
export function titleNames(a: TitleIdentity) {
  return [a.originalTitle, a.title, a.englishTitle, ...(a.aliases || [])].filter(
    (v): v is string => !!v,
  );
}
export type IdentityDecision = {
  status: 'AUTO-APPROVED' | 'NEEDS REVIEW' | 'REJECTED';
  reason: string;
  target?: TitleIdentity;
  basis?: string;
};
/** Identity matching never approves playback. AUTO-APPROVED belongs to the final video/rights gate. */
export function matchAnimeIdentity(
  source: SupplierIdentity,
  catalog: TitleIdentity[],
  origins: readonly string[] = [],
): IdentityDecision {
  const slug =
    confirmedSlug(source.url, origins, source.releaseId) ||
    (/^[a-z0-9_-]{1,300}$/i.test(source.officialAlias || '') ? source.officialAlias! : null);
  const sourceKeys = new Set(source.names.map(animeTitleKey).filter(Boolean));
  let targets: TitleIdentity[], basis: string;
  if (source.shikimoriId) {
    targets = catalog.filter((a) => a.shikimoriId === source.shikimoriId);
    basis = 'shikimori.id';
  } else if (source.malId) {
    targets = catalog.filter((a) => a.malId === source.malId);
    basis = 'mal.id';
  } else {
    targets = catalog.filter(
      (a) =>
        titleNames(a).some((n) => sourceKeys.has(animeTitleKey(n))) ||
        (!!slug && titleNames(a).some((n) => animeTitleKey(n) === animeTitleKey(slug))),
    );
    basis = 'metadata';
  }
  if (!targets.length)
    return {
      status: 'NEEDS REVIEW',
      reason: source.shikimoriId || source.malId ? 'external-id-outside-catalog' : 'no-exact-title',
    };
  // Never rescue an outside/conflicting ID using a similar title.
  if (
    source.shikimoriId &&
    source.malId &&
    targets.some((a) => a.malId && a.malId !== source.malId)
  )
    return { status: 'REJECTED', reason: 'conflicting-external-ids' };
  const compatible = targets.filter(
    (a) => a.year && source.year && a.year === source.year && a.kind === source.kind,
  );
  if (compatible.length !== 1)
    return {
      status: 'NEEDS REVIEW',
      reason: compatible.length ? 'ambiguous-identity' : 'year-or-format-conflict',
    };
  const target = compatible[0];
  const exact = titleNames(target).find((n) => sourceKeys.has(animeTitleKey(n)));
  if (!exact && !(slug && titleNames(target).some((n) => animeTitleKey(n) === animeTitleKey(slug))))
    return { status: 'REJECTED', reason: 'title-not-confirmed', target };
  if (basis === 'metadata')
    basis = !exact
      ? 'url-slug'
      : exact === target.originalTitle
        ? 'original-title'
        : exact === target.title
          ? 'russian-title'
          : exact === target.englishTitle
            ? 'english-title'
            : 'alias';
  if (
    !source.episodeNumbers.length ||
    source.episodeNumbers.some((n) => !Number.isSafeInteger(n) || n < 1) ||
    new Set(source.episodeNumbers).size !== source.episodeNumbers.length
  )
    return { status: 'NEEDS REVIEW', reason: 'invalid-or-empty-episodes', target, basis };
  if (target.episodes && Math.max(...source.episodeNumbers) > target.episodes)
    return { status: 'NEEDS REVIEW', reason: 'episode-range-conflict', target, basis };
  return { status: 'NEEDS REVIEW', reason: 'identity-only-awaits-video', target, basis };
}
/** Transliteration is deliberately review-only; it never changes a strict key. */
export function titleReviewKey(value: string) {
  return animeTitleKey(value)
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti');
}
export class AnimeTitleMatcher {
  private names = new Map<string, Set<TitleIdentity>>();
  private ids = new Map<number, TitleIdentity[]>();
  private mal = new Map<number, TitleIdentity[]>();
  private loose = new Map<string, Set<number>>();
  private origins: readonly string[];
  constructor(catalog: TitleIdentity[], origins: readonly string[] = []) {
    this.origins = origins;
    for (const a of catalog) {
      if (a.shikimoriId) this.ids.set(a.shikimoriId, [...(this.ids.get(a.shikimoriId) || []), a]);
      if (a.malId) this.mal.set(a.malId, [...(this.mal.get(a.malId) || []), a]);
      for (const name of titleNames(a)) {
        const key = animeTitleKey(name);
        if (!key) continue;
        const values = this.names.get(key) || new Set();
        values.add(a);
        this.names.set(key, values);
        const loose = titleReviewKey(name);
        const ids = this.loose.get(loose) || new Set<number>();
        if (a.shikimoriId) ids.add(a.shikimoriId);
        this.loose.set(loose, ids);
      }
    }
  }
  match(source: SupplierIdentity) {
    const slug =
      confirmedSlug(source.url, this.origins, source.releaseId) ||
      (/^[a-z0-9_-]{1,300}$/i.test(source.officialAlias || '') ? source.officialAlias! : null);
    const targets = source.shikimoriId
      ? this.ids.get(source.shikimoriId) || []
      : source.malId
        ? this.mal.get(source.malId) || []
        : [
            ...new Set(
              [...source.names, ...(slug ? [slug] : [])].flatMap((n) => [
                ...(this.names.get(animeTitleKey(n)) || []),
              ]),
            ),
          ];
    return matchAnimeIdentity(source, targets, this.origins);
  }
  suggest(source: SupplierIdentity): number[] {
    // Common long-vowel / Hepburn variants are only a review hint. Never feed
    // this map into match(), and never strip season or part numbers.
    return [
      ...new Set(source.names.flatMap((n) => [...(this.loose.get(titleReviewKey(n)) || [])])),
    ].slice(0, 5);
  }
}

export function canonicalAnimeKind(value: string) {
  const kind = value.normalize('NFKC').toLowerCase().trim();
  return (
    (
      {
        тв: 'tv',
        'тв-сериал': 'tv',
        'tv special': 'special',
        tv_special: 'special',
        'тв-спэшл': 'special',
        'полнометражный фильм': 'movie',
        'короткометражный фильм': 'movie',
      } as Record<string, string>
    )[kind] || kind
  );
}
