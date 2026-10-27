# AniRezik 0.5.3 — AnimeVost stability

## Actual additional video sample, 2026-10-28

15 titles / 17 unique episode videos decoded with advancing time in the existing Player (Chromium). Public playlist API: 15 HTTP 200 responses; media: 17 HTTP 206 responses. Zero supplier failures observed in this sample; this does not guarantee every episode, quality or region.

Existing configured sample: 1, 43 (film), 21 (first and last indexed episode), 269, 918, 52991, 58567, 16498, 63382 (first and last indexed episode), 63098. Deferred standalone sample: 1761, 28069, 21667, 18441, 37735. Detailed decoded dimensions/time are in `docs/diagnostics/ANIMEVOST_STABILITY_0.5.3.json`. Older files can have low source resolution; SD/HD are supplier labels, not promises of 480p/720p. No invented upscale or quality.

## Expansion

Five of the original 866 deferred records passed exact title/year/format/single-episode checks and actual playback: 1761, 28069, 21667, 18441, 37735. Four receive their first configured provider; 28069 already has AniLiberty. New AnimeVost title-specific translation options: five (one supplier track each), not five distinct studios. Index: 2,741 mappings / 43,781 episode metadata numbers, +5 each. These totals are configuration, not a claim all videos were played.

861 deferred remain: 70 of 75 plausible singleton entries await video checking; one has conflicting canonical episode count; 67 range conflicts (34 large, 33 modest) remain disabled. Other reasons: 258 format, 395 no exact title, 51 year, 15 unknown episode label/empty metadata, 4 ambiguity. Unknown metadata is not proof video is absent. Full classification: `docs/diagnostics/ANIMEVOST_DEFERRED_0.5.3.json`. No full API crawl was repeated; saved 3,602 release rows reused. Upstream total discrepancy (3,611 reported) remains unresolved.

## Recovery and verified behavior

Fixed retry reusing stale media URL: one forced fresh playlist per exact selection, same episode/translation, same quality if still available, preserved position. Requests coalesce, manual refresh has a 30-second cooldown; no infinite loop. Detached/failed media cannot overwrite valid progress. If refresh fails, user can select an already authorized alternative for the same episode. No URL guessing, changed origin, region bypass or video proxy.

Isolated fault tests cover expired HD→fresh HD with actual fixture decoding and resumed position after reload; denied refresh→no request loop and explicit CVH fallback keeping episode 2 despite provider history on episode 3. Licensed Sintel test fixture is not an anime source and is excluded from video counts. Cross-engine and actual SD/HD/episode controls gate publication in Pages CI; results recorded below after the run.

## Supplier conditions and limits

Existing documented AnimeVost permission remains the basis for direct playback. Official public [rules](https://animevost.org/rules.html), [feedback](https://animevost.org/index.php?do=feedback) and [copyright page](https://animevost.org/dlya-pravoobladateley.html) did not establish numerical API rate limits or media URL TTL. Five-minute cache and 30-second refresh cooldown are our own conservative policy. No recurring import schedule enabled.

Before incremental synchronization request: permitted requests/sec, burst/day budget, Retry-After behavior, metadata cache duration, link expiry/refresh contract, withdrawal handling, and explanation of reported-total discrepancy. Existing saved error/checkpoint is not cleared and no API keys are exposed.

## Publication

Pending final production browser gates. No claim of deployment until the successful Pages run is linked here.
