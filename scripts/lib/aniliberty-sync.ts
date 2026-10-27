import { createHash } from 'node:crypto';
import { animeTitleKey } from '../../src/lib/anime-title-matcher.ts';
import { releaseMetadataMatches } from '../../src/lib/providers/video/aniliberty.ts';
import type { LibertyRelease, MatchMetadata } from '../../src/lib/providers/video/aniliberty.ts';

export type SyncAnime = MatchMetadata & { shikimoriId: number };
export interface LibertyEvidence {
  releaseId: number;
  shikimoriId: number | null;
  stamp: string;
  checkedAt: string;
  status: 'ready' | 'blocked' | 'no-hls' | 'needs-review' | 'outside-catalog' | 'withdrawn';
  reason: string;
  episodeCount: number;
  episodeNumbers?: number[];
  fractionalEpisodes: number;
  qualities: number[];
  title: string;
  year: number;
  format: string;
  basis: string;
  malId?: number;
  blocked: boolean;
}
export interface LibertySyncState {
  schemaVersion: 2;
  phase: 'catalog' | 'details' | 'complete';
  cycleStartedAt: string;
  completedAt: string | null;
  nextPage: number;
  total: number | null;
  totalPages: number | null;
  pages: Record<string, number[]>;
  catalog: Record<string, LibertyRelease>;
  pending: number[];
  evidence: Record<string, LibertyEvidence>;
  error?: { at: string; message: string; retryAfter?: string | null };
  baselineMappedIds?: number[];
  previouslyMappedIds?: number[];
  resumeAfter?: string;
  requestsTotal?: number;
  withdrawalPending?: number[];
  withdrawals?: { releaseId: number; reason: 'confirmed-404' | 'copyright'; checkedAt: string }[];
}
export function validateLibertyState(value: unknown): asserts value is LibertySyncState {
  const s = value as LibertySyncState;
  if (
    !s ||
    s.schemaVersion !== 2 ||
    !['catalog', 'details', 'complete'].includes(s.phase) ||
    !s.catalog ||
    !s.evidence ||
    !s.pages ||
    !Array.isArray(s.pending) ||
    !Number.isSafeInteger(s.nextPage) ||
    s.nextPage < 1
  )
    throw Error('Invalid checkpoint');
  for (const [id, row] of Object.entries(s.catalog)) {
    if (Number(id) !== row.id || JSON.stringify(row) !== JSON.stringify(cleanLibertySummary(row)))
      throw Error('Unsanitized checkpoint catalog');
  }
  const statuses = ['ready', 'blocked', 'no-hls', 'needs-review', 'outside-catalog', 'withdrawn'];
  const fields = [
    'releaseId',
    'shikimoriId',
    'stamp',
    'checkedAt',
    'status',
    'reason',
    'episodeCount',
    'episodeNumbers',
    'fractionalEpisodes',
    'qualities',
    'title',
    'year',
    'format',
    'basis',
    'malId',
    'blocked',
  ];
  for (const [id, e] of Object.entries(s.evidence)) {
    if (
      Number(id) !== e.releaseId ||
      !statuses.includes(e.status) ||
      !Number.isSafeInteger(e.episodeCount) ||
      e.episodeCount < 0 ||
      (e.episodeNumbers !== undefined &&
        (!Array.isArray(e.episodeNumbers) ||
          e.episodeNumbers.some((n) => !Number.isFinite(n) || n <= 0) ||
          new Set(e.episodeNumbers).size !== e.episodeNumbers.length)) ||
      !Number.isFinite(Date.parse(e.checkedAt)) ||
      !/^[a-f0-9]{64}$/.test(e.stamp) ||
      !Array.isArray(e.qualities) ||
      e.qualities.some((q) => ![480, 720, 1080].includes(q)) ||
      Object.keys(e).some((k) => !fields.includes(k))
    )
      throw Error('Invalid checkpoint evidence');
  }
  if (s.pending.some((id) => !s.catalog[id])) throw Error('Invalid pending release');
  if (s.withdrawalPending?.some((id) => !Number.isSafeInteger(id) || id < 1))
    throw Error('Invalid withdrawal queue');
  if (
    s.withdrawals?.some(
      (w) =>
        !Number.isSafeInteger(w.releaseId) ||
        w.releaseId < 1 ||
        !['confirmed-404', 'copyright'].includes(w.reason) ||
        !Number.isFinite(Date.parse(w.checkedAt)),
    )
  )
    throw Error('Invalid withdrawal evidence');
}
export function planLibertyWithdrawals(
  state: LibertySyncState,
  previous: Record<string, { releaseId: number }>,
) {
  if (
    state.phase === 'catalog' ||
    Object.keys(state.catalog).length !== state.total ||
    Object.keys(state.pages).length !== state.totalPages
  )
    throw Error('Cannot infer absence from partial catalog');
  if (!state.total && Object.keys(previous).length)
    throw Error('Empty supplier catalog requires manual review; existing sources preserved');
  return [...new Set(Object.values(previous).map((m) => m.releaseId))].filter(
    (id) => !state.catalog[id],
  );
}
export function newLibertyState(now = Date.now()): LibertySyncState {
  return {
    schemaVersion: 2,
    phase: 'catalog',
    cycleStartedAt: new Date(now).toISOString(),
    completedAt: null,
    nextPage: 1,
    total: null,
    totalPages: null,
    pages: {},
    catalog: {},
    pending: [],
    evidence: {},
  };
}
export function cleanLibertySummary(r: LibertyRelease): LibertyRelease {
  if (!r || !Number.isSafeInteger(r.id) || r.id < 1 || !r.name || !r.type)
    throw new Error('Invalid release summary');
  return {
    id: r.id,
    alias:
      typeof r.alias === 'string' && /^[a-z0-9_-]{1,300}$/i.test(r.alias) ? r.alias : undefined,
    year: Number.isSafeInteger(r.year) ? r.year : 0,
    name: {
      main: typeof r.name.main === 'string' ? r.name.main : '',
      english: r.name.english || undefined,
      alternative: r.name.alternative || undefined,
    },
    type: { value: typeof r.type.value === 'string' ? r.type.value : '' },
    shikimori: r.shikimori ? { id: r.shikimori.id } : null,
    mal: r.mal ? { id: r.mal.id } : null,
    updated_at: r.updated_at,
    fresh_at: r.fresh_at,
    is_ongoing: r.is_ongoing,
    is_blocked_by_geo: r.is_blocked_by_geo,
    is_blocked_by_copyrights: r.is_blocked_by_copyrights,
  };
}
export const libertyStamp = (r: LibertyRelease) => {
  const summary = cleanLibertySummary(r);
  // An added alias alone must not cause a repeated detail scan of all known IDs.
  if (summary.shikimori?.id || summary.mal?.id) delete summary.alias;
  return createHash('sha256').update(JSON.stringify(summary)).digest('hex');
};
const key = animeTitleKey;
function sameName(r: LibertyRelease, a: MatchMetadata) {
  const names = [a.title, a.originalTitle, a.englishTitle || '', ...(a.aliases || [])]
    .map(key)
    .filter(Boolean);
  return [
    r.name.main,
    r.name.english || '',
    r.name.alternative || '',
    r.alias || '',
    ...(r.name.alternative || '').split(/[,;\/]/),
  ].some((n) => names.includes(key(n)));
}
export function identifyLiberty(r: LibertyRelease, anime: SyncAnime[]) {
  const external = Number(r.shikimori?.id),
    mal = Number(r.mal?.id);
  let targets: SyncAnime[] = [];
  let basis = 'shikimori.id';
  if (Number.isSafeInteger(external) && external > 0)
    targets = anime.filter((a) => a.shikimoriId === external);
  else if (Number.isSafeInteger(mal) && mal > 0) {
    targets = anime.filter((a) => a.malId === mal);
    basis = 'mal.id';
  }
  if (!targets.length && !(external > 0)) {
    // Metadata proposals stay in review, never become automatic title-only links.
    targets = anime.filter((a) => a.year === r.year && sameName(r, a));
    return {
      target: targets.length === 1 ? targets[0] : undefined,
      basis: 'metadata',
      reason: targets.length ? 'metadata-only-candidate' : 'no-trusted-external-id',
    };
  }
  if (targets.length !== 1)
    return {
      target: undefined,
      basis,
      reason: targets.length ? 'ambiguous-external-id' : 'external-id-outside-catalog',
    };
  const target = targets[0];
  if (external > 0 && mal > 0 && target.malId && target.malId !== mal)
    return { target, basis, reason: 'conflicting-external-ids' };
  if (
    !target.year ||
    !r.year ||
    !r.type.value ||
    !target.type ||
    !releaseMetadataMatches(r, target)
  )
    return { target, basis, reason: 'contradictory-year-format-or-season' };
  if (!sameName(r, target)) return { target, basis, reason: 'title-not-confirmed' };
  return { target, basis, reason: '' };
}
export function inspectLiberty(
  r: LibertyRelease,
  anime: SyncAnime[],
  origins: readonly string[],
  now = Date.now(),
): LibertyEvidence {
  r = { ...cleanLibertySummary(r), episodes: r.episodes };
  const match = identifyLiberty(r, anime);
  const evidence: LibertyEvidence = {
    releaseId: r.id,
    shikimoriId: match.target?.shikimoriId || Number(r.shikimori?.id) || null,
    stamp: libertyStamp(r),
    checkedAt: new Date(now).toISOString(),
    status: 'needs-review',
    reason: match.reason,
    episodeCount: 0,
    fractionalEpisodes: 0,
    qualities: [],
    title: r.name.main,
    year: r.year,
    format: r.type.value,
    basis: match.basis,
    malId: match.basis === 'mal.id' ? Number(r.mal?.id) : undefined,
    blocked: r.is_blocked_by_geo === true || r.is_blocked_by_copyrights === true,
  };
  if (r.is_blocked_by_geo === true || r.is_blocked_by_copyrights === true) {
    evidence.status = match.reason ? 'needs-review' : 'blocked';
    evidence.reason =
      match.reason || (r.is_blocked_by_copyrights ? 'copyright' : 'geo-in-sync-region');
    return evidence;
  }
  if (
    r.is_blocked_by_geo !== false ||
    r.is_blocked_by_copyrights !== false ||
    !Array.isArray(r.episodes)
  ) {
    evidence.reason = 'missing-availability-or-episodes';
    return evidence;
  }
  const allowedNumbers = new Set<number>();
  const numbers = new Set<number>(),
    ids = new Set<string>(),
    qualities = new Set<number>();
  for (const ep of r.episodes) {
    if (
      !ep ||
      typeof ep.id !== 'string' ||
      !/^[a-z\d-]{1,128}$/i.test(ep.id) ||
      !Number.isFinite(ep.ordinal) ||
      ep.ordinal <= 0
    )
      continue;
    if (ids.has(ep.id) || numbers.has(ep.ordinal)) {
      evidence.reason = 'duplicate-episode-id-or-ordinal';
      return evidence;
    }
    ids.add(ep.id);
    numbers.add(ep.ordinal);
    const allowed = [480, 720, 1080].filter((q) => {
      const value = ep[`hls_${q}` as keyof typeof ep];
      if (typeof value !== 'string' || !value) return false;
      try {
        const u = new URL(value);
        return u.protocol === 'https:' && !u.username && !u.password && origins.includes(u.origin);
      } catch {
        return false;
      }
    });
    if (!allowed.length) continue;
    allowedNumbers.add(ep.ordinal);
    evidence.episodeCount++;
    if (!Number.isInteger(ep.ordinal)) evidence.fractionalEpisodes++;
    allowed.forEach((q) => qualities.add(q));
  }
  evidence.qualities = [...qualities].sort((a, b) => a - b);
  evidence.episodeNumbers = [...allowedNumbers].sort((a, b) => a - b);
  if (match.reason) {
    evidence.status =
      match.reason === 'external-id-outside-catalog' ? 'outside-catalog' : 'needs-review';
    return evidence;
  }
  evidence.status = evidence.episodeCount ? 'ready' : 'no-hls';
  evidence.reason = evidence.episodeCount ? '' : 'no-allowed-hls-episodes';
  return evidence;
}
export function planLibertyDetails(state: LibertySyncState, now = Date.now()) {
  const rows = Object.values(state.catalog);
  if (state.total !== rows.length || Object.keys(state.pages).length !== state.totalPages)
    throw new Error('Catalog changed during pagination; complete coverage not established');
  state.pending = rows
    .filter((r) => {
      const old = state.evidence[r.id];
      return (
        !old ||
        (!old.episodeNumbers && ['needs-review', 'outside-catalog'].includes(old.status)) ||
        old.stamp !== libertyStamp(r) ||
        now - Date.parse(old.checkedAt) > (r.is_ongoing ? 6 : 24) * 3600000
      );
    })
    .map((r) => r.id)
    .sort((a, b) => a - b);
  state.phase = 'details';
}
export function buildLibertyIndex(state: LibertySyncState, baselineIds: number[]) {
  if (
    state.phase !== 'complete' ||
    state.pending.length ||
    state.withdrawalPending?.length ||
    Object.keys(state.catalog).length !== state.total
  )
    throw new Error('Cannot publish an incomplete AniLiberty scan');
  const groups = new Map<number, LibertyEvidence[]>();
  const reviews: LibertyEvidence[] = [];
  const rows = Object.keys(state.catalog).map((id) => state.evidence[id]);
  if (rows.some((r) => !r)) throw new Error('Missing release evidence');
  for (const r of rows) {
    if (r.status === 'needs-review') reviews.push(r);
    if (r.status !== 'ready' || !r.shikimoriId) continue;
    groups.set(r.shikimoriId, [...(groups.get(r.shikimoriId) || []), r]);
  }
  const mappings: Record<
    string,
    { releaseId: number; basis: string; checkedAt: string; malId?: number }
  > = {};
  for (const [id, group] of groups) {
    if (group.length !== 1) {
      reviews.push(
        ...group.map((r) => ({
          ...r,
          status: 'needs-review' as const,
          reason: 'multiple-valid-releases-for-shikimori-id',
        })),
      );
      continue;
    }
    mappings[id] = {
      releaseId: group[0].releaseId,
      basis: group[0].basis,
      checkedAt: group[0].checkedAt,
      ...(group[0].basis === 'mal.id' ? { malId: group[0].malId } : {}),
    };
  }
  const excludedIds = [
    ...new Set([
      ...baselineIds,
      ...(state.previouslyMappedIds || []),
      ...reviews.map((r) => r.shikimoriId).filter((id): id is number => !!id),
    ]),
  ]
    .filter((id) => !mappings[id])
    .sort((a, b) => a - b);
  return {
    index: { version: 2, checkedAt: state.completedAt, mappings, excludedIds },
    review: reviews.sort((a, b) => a.releaseId - b.releaseId),
    report: {
      version: 2,
      checkedAt: state.completedAt,
      complete: true,
      totalReleases: state.total,
      processedReleases: rows.length,
      catalogPages: Object.keys(state.pages).length,
      totalCatalogPages: state.totalPages,
      matchedAnime: Object.keys(mappings).length,
      newAnime: Object.keys(mappings).filter((id) => !baselineIds.includes(Number(id))).length,
      needsReview: reviews.length,
      blockedReleases: rows.filter((r) => r.blocked).length,
      releasesWithAllowedHls: rows.filter((r) => r.episodeCount > 0).length,
      outsideCatalog: rows.filter((r) => r.status === 'outside-catalog').length,
      noHls: rows.filter((r) => r.status === 'no-hls').length,
      remainingReleases: 0,
      fractionalEpisodes: rows.reduce((sum, r) => sum + r.fractionalEpisodes, 0),
      availableEpisodes: rows.reduce((sum, r) => sum + r.episodeCount, 0),
      mappedEpisodes: Object.values(mappings).reduce(
        (sum, m) => sum + state.evidence[m.releaseId].episodeCount,
        0,
      ),
      mappedFractionalEpisodes: Object.values(mappings).reduce(
        (sum, m) => sum + state.evidence[m.releaseId].fractionalEpisodes,
        0,
      ),
      hlsValidation:
        'HTTPS, exact approved origin and API availability; browser sample reported separately',
    },
  };
}
