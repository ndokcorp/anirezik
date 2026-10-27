import { createHash } from 'node:crypto';
import {
  AnimeTitleMatcher,
  canonicalAnimeKind,
  type TitleIdentity,
  type SupplierIdentity,
} from '../../src/lib/anime-title-matcher.ts';
export type SyncProvider = 'animevost' | 'aniliberty';
export interface SyncCandidate {
  provider: SyncProvider;
  id: number;
  releaseId: number;
  episodeNumbers: number[];
  kind: string;
  basis: string;
  fingerprint: string;
}
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function vostNumbers(series: unknown, kind: string): number[] {
  if (typeof series !== 'string') return [];
  const keys = [...series.matchAll(/['"]([^'"\\]+)['"]\s*:/gu)].map((m) => m[1]);
  if (
    keys.length === 1 &&
    ((kind === 'movie' && keys[0] === 'Фильм') ||
      (kind === 'ova' && /^(ова|ova)$/i.test(keys[0])) ||
      (kind === 'ona' && /^(она|ona)$/i.test(keys[0])))
  )
    return [1];
  return keys
    .filter((k) => /^\d+ серия$/.test(k))
    .map((k) => Number(k.split(' ')[0]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}
export function identityRecord(provider: SyncProvider, raw: any): SupplierIdentity {
  if (provider === 'animevost') {
    const kind = canonicalAnimeKind(String(raw.type || ''));
    return {
      releaseId: raw.id,
      names: String(raw.title || '')
        .replace(/\s*\[[^\]]*\]\s*$/u, '')
        .split(' / '),
      year: Number(raw.year) || null,
      kind,
      episodeNumbers: vostNumbers(raw.series, kind),
      url: typeof raw.url === 'string' ? raw.url : undefined,
    };
  }
  return {
    shikimoriId: raw.shikimori?.id,
    malId: raw.mal?.id,
    names: [raw.name?.main, raw.name?.english, raw.name?.alternative].filter(Boolean),
    year: raw.year || null,
    kind: canonicalAnimeKind(String(raw.type?.value || '')),
    episodeNumbers: raw.episodeNumbers || [],
  };
}
export function planIdentities(provider: SyncProvider, rows: any[], catalog: TitleIdentity[]) {
  const matcher = new AnimeTitleMatcher(
    catalog,
    provider === 'animevost' ? ['https://animevost.org'] : [],
  );
  const candidates: SyncCandidate[] = [],
    review: any[] = [];
  const identifiedByBasis: Record<string, number> = {};
  for (const raw of rows) {
    if (
      provider === 'aniliberty' &&
      (raw.is_blocked_by_geo !== false || raw.is_blocked_by_copyrights !== false)
    ) {
      review.push({
        provider,
        releaseId: raw.id,
        status: raw.is_blocked_by_copyrights === true ? 'REJECTED' : 'NEEDS REVIEW',
        reason:
          raw.is_blocked_by_copyrights === true
            ? 'copyright'
            : raw.is_blocked_by_geo === true
              ? 'geo'
              : 'missing-availability-flags',
      });
      continue;
    }
    const source = identityRecord(provider, raw),
      result = matcher.match(source);
    if (result.target && result.basis)
      identifiedByBasis[result.basis] = (identifiedByBasis[result.basis] || 0) + 1;
    if (result.reason !== 'identity-only-awaits-video' || !result.target?.shikimoriId) {
      review.push({
        provider,
        releaseId: raw.id,
        status: result.status,
        reason: result.reason,
        id: result.target?.shikimoriId,
        basis: result.basis,
        suggestedIds: matcher.suggest(source),
      });
      continue;
    }
    if (
      provider === 'animevost' &&
      source.episodeNumbers.length === 1 &&
      !/^['"]?\d+ серия/.test(String(raw.series).replace(/^\{/, '')) &&
      source.kind !== 'movie' &&
      result.target.episodes !== 1
    ) {
      review.push({
        provider,
        releaseId: raw.id,
        status: 'NEEDS REVIEW',
        reason: 'singleton-count-conflict',
      });
      continue;
    }
    candidates.push({
      provider,
      id: result.target.shikimoriId,
      releaseId: raw.id,
      episodeNumbers: source.episodeNumbers,
      kind: source.kind,
      basis: result.basis!,
      fingerprint: fingerprint({
        source,
        target: {
          id: result.target.shikimoriId,
          year: result.target.year,
          kind: result.target.kind,
          episodes: result.target.episodes,
        },
      }),
    });
  }
  const groups = new Map<number, SyncCandidate[]>();
  for (const c of candidates) groups.set(c.id, [...(groups.get(c.id) || []), c]);
  const unique: SyncCandidate[] = [];
  for (const group of groups.values())
    if (group.length === 1) unique.push(group[0]);
    else
      review.push(
        ...group.map((c) => ({
          provider,
          releaseId: c.releaseId,
          id: c.id,
          status: 'NEEDS REVIEW',
          reason: 'multiple-provider-releases',
        })),
      );
  return { candidates: unique, review, identifiedByBasis };
}
export function chooseQueue(
  candidates: SyncCandidate[],
  evidence: Record<string, { fingerprint: string; checkedAt: string; passed: boolean }>,
  max: number,
  now = Date.now(),
  retryMs = 86400000,
) {
  return candidates
    .filter((c) => {
      const e = evidence[`${c.provider}:${c.releaseId}`];
      return (
        !e || e.passed || e.fingerprint !== c.fingerprint || now - Date.parse(e.checkedAt) > retryMs
      );
    })
    .sort((a, b) => a.releaseId - b.releaseId)
    .slice(0, max);
}
