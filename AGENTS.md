# AniRezik

- Before edits, read README.md and docs/ARCHITECTURE.md and inspect existing components.
- Preserve ANIREZIK branding, white ANI / red REZIK, dark backgrounds and restrained glass effects. Do not redesign without a request.
- Reuse components, keep data separate from markup, and add features modularly.
- Preserve existing working features and strict TypeScript. Avoid server dependencies unless needed.
- All internal links and assets use src/lib/paths.ts to support GitHub Pages subpaths.
- Never imply that visual placeholders, accounts, playback, ratings or schedule data work when unavailable.
- Use permitted/original assets; never scrape posters or unofficial videos.
- Run npm run check, npm run build and relevant Playwright tests after changes. Test both / and /anirezik base paths for routing changes.
- Update documentation when behavior, deployment or architecture changes.
- Metadata is imported by scripts/sync-anime.ts through src/lib/providers/shikimori; builds must use the checked-in snapshot and must not require network access.
- Never reintroduce demo metadata, fabricate missing scores/dates/episode availability, or identify animation studios as dubbing studios.
- Preserve shikimori:<numeric ID>, legacy slugs, storage migration backups and previously imported pages.
- Default posters are placeholders; API poster URLs and third-party descriptions require independently documented reuse rights before publication.
- Images must be resolved through src/lib/images.ts and image-rights.json; preserve explicit AI attribution. Unknown rights never activate API URLs. Test image decoding and real request failures.
- Keep search-index.json shared across all pages; do not embed the full catalog in every HTML document. Expanded sync resumes from cached validated batches; retain stable IDs and pages.
- Video sources require an explicitly approved provider, rights records, exact HTTPS origins and region checks. No provider is enabled in 0.2.0.
