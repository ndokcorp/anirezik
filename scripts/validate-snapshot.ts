import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertCatalogUpdate } from '../src/lib/providers/shikimori/snapshot.ts';
const baseline = process.argv[2] || 'HEAD';
if (!/^[\w/.-]+$/.test(baseline)) throw new Error('Invalid baseline ref');
const previous = JSON.parse(
  execFileSync('git', ['show', `${baseline}:src/data/catalog.json`], {
    maxBuffer: 100 * 1024 * 1024,
    encoding: 'utf8',
  }),
);
const next = JSON.parse(await readFile('src/data/catalog.json', 'utf8'));
assertCatalogUpdate(previous, next);
const allow = new Set([
  'src/data/catalog.json',
  'src/data/catalog-coverage.json',
  'src/data/catalog-maintenance.json',
]);
const changed = execFileSync('git', ['diff', '--name-only', baseline], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const unknown = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);
if ([...changed, ...unknown].some((file) => !allow.has(file)))
  throw new Error('Metadata automation may only modify the snapshot and sync reports');
console.log(
  `Validated ${next.anime.length} IDs, retained ${previous.anime.length}; metadata-only diff`,
);
