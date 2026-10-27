import { test, expect } from '@playwright/test';
import { AniLibertyApi } from '../src/lib/providers/video/aniliberty';
import {
  AnimeTitleMatcher,
  animeTitleKey,
  confirmedSlug,
  canonicalAnimeKind,
  type TitleIdentity,
  type SupplierIdentity,
} from '../src/lib/anime-title-matcher';
import { chooseQueue, planIdentities, vostNumbers } from '../scripts/lib/global-auto-sync';
import {
  libertyStamp,
  newLibertyState,
  planLibertyWithdrawals,
} from '../scripts/lib/aniliberty-sync';
const anime: TitleIdentity = {
  shikimoriId: 59193,
  title: 'Реинкарнация безработного: История о приключениях в другом мире 3',
  originalTitle: 'Mushoku Tensei III: Isekai Ittara Honki Dasu',
  aliases: ['Mushoku Tensei: Jobless Reincarnation Season 3'],
  year: 2026,
  kind: 'tv',
  episodes: 14,
};
const source: SupplierIdentity = {
  names: ['Mushoku Tensei 3: Isekai Ittara Honki Dasu'],
  year: 2026,
  kind: 'tv',
  episodeNumbers: [1, 2, 14],
};
test('matcher: III, Arabic and ordinal seasons; parts and sequel numbers retained', () => {
  for (const s of [
    'Mushoku Tensei III',
    'Mushoku Tensei Season 3',
    'Mushoku Tensei 3rd Season',
    'Mushoku Tensei третий сезон',
  ])
    expect(animeTitleKey(s)).toBe('mushokutensei3');
  expect(animeTitleKey('Ёж — III')).toBe(animeTitleKey('Еж 3'));
  expect(animeTitleKey('Mushoku Tensei III Part 2')).not.toBe(animeTitleKey('Mushoku Tensei III'));
  const m = new AnimeTitleMatcher([anime]);
  expect(m.match(source)).toMatchObject({
    status: 'NEEDS REVIEW',
    reason: 'identity-only-awaits-video',
    target: { shikimoriId: 59193 },
    basis: 'original-title',
  });
});
test('matcher: year, format, remake, ambiguity and combined seasons never guessed', () => {
  const m = new AnimeTitleMatcher([
    anime,
    {
      ...anime,
      shikimoriId: 65077,
      year: 2027,
      originalTitle: anime.originalTitle + ' Part 2',
      title: anime.title + ' Часть 2',
      aliases: [],
    },
  ]);
  expect(m.match({ ...source, year: 2025 }).reason).not.toBe('identity-only-awaits-video');
  expect(m.match({ ...source, kind: 'movie' }).reason).not.toBe('identity-only-awaits-video');
  expect(m.match({ ...source, episodeNumbers: [1, 28] }).reason).toBe('episode-range-conflict');
  expect(m.match({ ...source, episodeNumbers: [] }).reason).toBe('invalid-or-empty-episodes');
  expect(new AnimeTitleMatcher([anime, { ...anime, shikimoriId: 99 }]).match(source).reason).toBe(
    'ambiguous-identity',
  );
  expect(
    m.match({ ...source, names: ['Mushoku Tensei II: Isekai Ittara Honki Dasu'] }).status,
  ).not.toBe('AUTO-APPROVED');
});
test('matcher: conflicting or outside external IDs cannot fall back to title', () => {
  const m = new AnimeTitleMatcher([{ ...anime, malId: 40 }]);
  expect(m.match({ ...source, shikimoriId: 59193, malId: 41 }).reason).toBe(
    'conflicting-external-ids',
  );
  expect(m.match({ ...source, shikimoriId: 999 }).reason).not.toBe('identity-only-awaits-video');
});
test('matcher: only real allowlisted supplier URL supplies slug, no guessed links', () => {
  const url = 'https://animevost.org/tip/tv/3922-mushoku-tensei-3-isekai-ittara-honki-dasu.html';
  expect(confirmedSlug(url, ['https://animevost.org'])).toBe(
    'mushoku-tensei-3-isekai-ittara-honki-dasu',
  );
  expect(
    confirmedSlug(url.replace('animevost.org', 'evil.test'), ['https://animevost.org']),
  ).toBeNull();
  expect(confirmedSlug(url, ['https://animevost.org'], 999)).toBeNull();
  expect(canonicalAnimeKind('Полнометражный фильм')).toBe('movie');
  expect(canonicalAnimeKind('ТВ-спэшл')).toBe('special');
  expect(canonicalAnimeKind('OVA')).not.toBe(canonicalAnimeKind('ТВ'));
  expect(
    new AnimeTitleMatcher([anime], ['https://animevost.org']).match({ ...source, names: [], url }),
  ).toMatchObject({
    status: 'NEEDS REVIEW',
    reason: 'identity-only-awaits-video',
    basis: 'url-slug',
  });
});
test('matcher: transliteration is review-only, never percentage auto approval', () => {
  const m = new AnimeTitleMatcher([
    { ...anime, originalTitle: 'Mahou Shoujo 3', title: 'Magic Girl 3', aliases: [] },
  ]);
  const row = { ...source, names: ['Maho Shojo 3'] };
  expect(m.match(row).reason).not.toBe('identity-only-awaits-video');
  expect(m.suggest(row)).toEqual([59193]);
});
test('official AniLiberty alias is a strict slug hint; adding it does not rescan all external IDs', () => {
  const m = new AnimeTitleMatcher([anime]);
  expect(
    m.match({ ...source, names: [], officialAlias: 'mushoku-tensei-3-isekai-ittara-honki-dasu' }),
  ).toMatchObject({
    reason: 'identity-only-awaits-video',
    basis: 'url-slug',
    target: { shikimoriId: 59193 },
  });
  expect(
    m.match({ ...source, names: [], officialAlias: 'https://foreign.test/title' }).reason,
  ).not.toBe('identity-only-awaits-video');
  const row = {
    id: 1,
    year: 2026,
    name: { main: 'Example' },
    type: { value: 'TV' },
    shikimori: { id: 59193 },
    is_blocked_by_geo: false,
    is_blocked_by_copyrights: false,
    updated_at: '',
  };
  expect(libertyStamp({ ...row, alias: 'example' })).toBe(libertyStamp(row));
  expect(libertyStamp({ ...row, shikimori: null, alias: 'example' })).not.toBe(
    libertyStamp({ ...row, shikimori: null }),
  );
});
test('HTML challenge is not a successful API response', async () => {
  const api = new AniLibertyApi(
    async () =>
      new Response('<html>challenge</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  );
  await expect(api.catalogPageResult(1, 50)).rejects.toThrow('manual review required');
});
test('queue: failed videos back off; changed metadata resumes; unpublished success can retry publication', () => {
  const c = {
    provider: 'animevost' as const,
    id: 59193,
    releaseId: 3922,
    episodeNumbers: [1],
    kind: 'tv',
    basis: 'original-title',
    fingerprint: 'a',
  };
  const now = Date.now();
  const records = {
    'animevost:3922': { fingerprint: 'a', checkedAt: new Date(now).toISOString(), passed: false },
  };
  expect(chooseQueue([c], records, 5, now)).toEqual([]);
  expect(chooseQueue([{ ...c, fingerprint: 'b' }], records, 5, now)).toHaveLength(1);
  expect(chooseQueue([c], records, 5, now + 86400001)).toHaveLength(1);
  expect(
    chooseQueue([c], { 'animevost:3922': { ...records['animevost:3922'], passed: true } }, 5, now),
  ).toHaveLength(1);
});
test('withdrawal queue: absence only schedules an official detail check after full metadata coverage', () => {
  const state = newLibertyState();
  expect(() => planLibertyWithdrawals(state, { '1': { releaseId: 100 } })).toThrow();
  state.phase = 'details';
  state.total = 0;
  state.totalPages = 0;
  expect(() => planLibertyWithdrawals(state, { '1': { releaseId: 100 } })).toThrow();
  state.catalog[200] = {
    id: 200,
    year: 2026,
    name: { main: 'Known fixture' },
    type: { value: 'TV' },
    is_blocked_by_geo: false,
    is_blocked_by_copyrights: false,
    updated_at: '',
  };
  state.total = 1;
  state.totalPages = 1;
  state.pages = { '1': [200] };
  expect(
    planLibertyWithdrawals(state, { '1': { releaseId: 100 }, '2': { releaseId: 100 } }),
  ).toEqual([100]);
  expect(state.withdrawals).toBeUndefined(); // No deletion/404 is fabricated.
});
test('AnimeVost: explicit ordinal keys, no extras, range conflicts and duplicate releases quarantined', () => {
  expect(vostNumbers("{'1 серия':'x','Трейлер':'z','2 серия':'y'}", 'tv')).toEqual([1, 2]);
  expect(vostNumbers("{'ОВА':'x'}", 'tv')).toEqual([]);
  const row = {
    id: 3922,
    title: source.names[0],
    year: 2026,
    type: 'ТВ',
    series: "{'1 серия':'x','14 серия':'y'}",
  };
  expect(planIdentities('animevost', [row], [anime]).candidates[0].id).toBe(59193);
  expect(planIdentities('animevost', [row, { ...row, id: 3923 }], [anime]).candidates).toEqual([]);
});
