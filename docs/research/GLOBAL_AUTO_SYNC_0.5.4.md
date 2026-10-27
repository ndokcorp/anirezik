# Global Auto Sync — AniRezik 0.5.4

## Actual first pilot

Saved metadata reused: 3,602 AnimeVost releases, 1,884 AniLiberty releases. No full source crawl and no Shikimori network sync. Shared title matching considers original/Russian/English/alternate Japanese names and confirmed source slugs; external IDs have priority and contradictory IDs stay rejected. Roman III / Arabic 3 / 3rd Season / третий сезон and format case variants are covered by unit tests. Parts, remakes, different years and combined season ranges are not erased.

Five candidates were actually probed in the existing AniRezik Player. Four passed both decoded video/time advancement and seek on first/last available episodes: AnimeVost 59193→3922 (episodes 1 and 14), 7745→60 (one OVA), 9047→104 (one OVA); AniLiberty 31630→2129 (episodes 1 and 24). Six unique episode videos passed the full gate. AniLiberty 40496→8659 decoded its first episode but failed the seek gate, so it is not added. Playwright runner completion is not itself playback proof; use each report record's passed flag. Actual ordinal arrays for both AniLiberty releases were independently fetched from the permitted official API, not inferred from counts.

Three new titles receive their first configured source: 59193, 7745, 9047. 31630 gains an additional source. Initial indexes: AnimeVost 2,744; AniLiberty 1,589. These are configurations, not a claim every episode/quality/region was tested.

## Saved deferred analysis

All original 861 deferred AnimeVost rows were re-evaluated offline. The diagnostic JSON separates identity-ready proposals from real playback. It currently identifies 209 potential strict matches from this set, of which only three passed the initial live gate. 858 original deferred records remain unactivated. 73 range conflicts are quarantined (the old 67 plus additional conflicts exposed by better title matching); no arbitrary season splitting. No URL-only new match is claimed: the requested Mushoku Tensei III was found via its original title, not by treating release ID 3922 as Shikimori ID. Official page: https://animevost.org/tip/tv/3922-mushoku-tensei-3-isekai-ittara-honki-dasu.html .

Counts by title category in `docs/diagnostics/GLOBAL_AUTO_SYNC_0.5.4.json` describe metadata identities, not approved playback. Many legacy AniLiberty checkpoints have counts but lack ordinal arrays; unresolved releases await the existing bounded detail refresh before automatic video probing. No fabricated 1..N ranges are used in the final pipeline.

## Operation

- AniLiberty's existing `41 */6 * * *` workflow remains the sole periodic collector; repository variable ANILIBERTY_SYNC_ENABLED is true. It resumes its durable checkpoint and retrieves only new/changed/stale details, plus unresolved old evidence missing actual ordinals. Completion calls the common video gate. No second AniLiberty worker or duplicate cron.
- AnimeVost has no cron. Explicit manual `sync-animevost.yml` uses an incremental budget of two pages by default (maximum five), durable checkpoint, local exclusive lock, and then the common gate. A short or incomplete response does not remove old mappings. API 401/403/429 or invalid schema stops and saves error/Retry-After; operator investigation is required before resuming. No private token or proxy.
- Manual `global-auto-sync.yml` verifies up to five new candidates (maximum twenty) using saved metadata only. Its include_animevost option is explicit; calls originating from periodic AniLiberty / metadata workflows default to AniLiberty only. Until AnimeVost limits are confirmed there are no scheduled AnimeVost metadata or playlist requests.
- A failed video candidate is cached with its metadata fingerprint and a 24-hour retry backoff. Other independent passing candidates can publish. Index changes and actual source removals require the same production gate. Existing different-release mappings are not overwritten by a title guess.
- Checkpoints: existing codex/aniliberty-sync-state plus codex/animevost-sync-state. Candidate/review state uses Actions cache and diagnostic artifacts. Pipeline concurrency prevents duplicate jobs; local worker locks and matching run IDs prevent stale finalization. A crash leaves the published indexes intact; do not delete locks or reset checkpoints without inspecting the saved error.
- Local plan deliberately stages working-copy indexes for a dev-only video gate: `node scripts/global-auto-sync.ts plan`, opt-in `AUTO_SYNC_LIVE=1` Playwright with playwright.auto-sync.config.ts, then `node scripts/global-auto-sync.ts finalize`. Finalize restores baseline indexes and writes only a candidate artifact; it does not publish. Normally use Actions instead.

## Explicit limitations

Shikimori automatic refresh is OFF. The owner has not yet confirmed registered application identity and will configure SHIKIMORI_USER_AGENT / SHIKIMORI_SYNC_ENABLED later; do not invent or enable them. Provider sync uses the checked-in Shikimori snapshot and remains independent. After the owner reports registration/configuration ready, verify the official API and the existing metadata workflow separately.

AnimeVost public contact/rules pages did not establish numerical query limits, burst/day budgets, media TTL or revocation semantics. Ask the supplier for those conditions before enabling any periodic AnimeVost API requests. The current two-second metadata interval / five-page manual cap are our own conservative controls, not supplier-guaranteed limits. The old full-scan total discrepancy (3,602 saved / 3,611 reported, page 91) remains recorded and is not claimed resolved by incremental windows.

The current pipeline checks a sample (first/last episode) and controlled seek; it does not certify every episode, all qualities or all regions. Runtime provider rights, geography, copyright flags and exact stream-origin checks remain enforced. Media URLs are always fresh runtime data; none are written to indexes, checkpoints, evidence, logs or the repository.

## Release validation / deployment

Pending final build/browser gates and an end-to-end Actions run; no deployment claim until the successful run is recorded below.
