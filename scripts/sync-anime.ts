import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { syncMaintenance } from '../src/lib/providers/shikimori/sync.ts';
import type { MaintenanceState } from '../src/lib/providers/shikimori/maintenance.ts';
import { syncFullCatalog } from '../src/lib/providers/shikimori/full-sync.ts';
import type { CatalogSnapshot } from '../src/types/anime.ts';
import editorial from '../src/data/editorial.json' with { type: 'json' };
const output = resolve('src/data/catalog.json');
let previous: CatalogSnapshot | null = null;
try {
  previous = JSON.parse(await readFile(output, 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const args = process.argv.slice(2);
if (!process.env.SHIKIMORI_USER_AGENT?.trim())
  throw new Error(
    'Set SHIKIMORI_USER_AGENT to the registered Shikimori application name before syncing',
  );
if (args.some((arg) => arg.startsWith('--target=')))
  throw new Error('--target is obsolete; maintenance preserves the complete catalog');
let state: MaintenanceState | undefined;
try {
  state = JSON.parse(await readFile('src/data/catalog-maintenance.json', 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const ids = args
  .filter((arg) => arg.startsWith('--ids='))
  .flatMap((arg) => arg.slice(6).split(',').map(Number));
if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Неверные --ids');
try {
  const config = {
    output,
    cacheDir: resolve('.cache/shikimori'),
    base: process.env.SHIKIMORI_BASE_URL,
    userAgent: process.env.SHIKIMORI_USER_AGENT,
    previous,
    ids,
    editorialDescriptions: Object.fromEntries(
      Object.entries(editorial).map(([id, item]) => [id, item.description]),
    ),
    maxAgeMs: args.includes('--force') ? 0 : undefined,
  };
  const snapshot = args.includes('--full')
    ? await syncFullCatalog({ ...config, reportFile: resolve('src/data/catalog-coverage.json') })
    : await syncMaintenance({
        ...config,
        state,
        reportFile: resolve('src/data/catalog-maintenance.json'),
      });
  console.log(
    `Shikimori: сохранено ${snapshot.anime.length} аниме; ${snapshot.fetchedAt}. Постеры и описания API не публикуются без подтверждённых прав.`,
  );
} catch (error) {
  console.error(
    `Обновление не выполнено. Предыдущий каталог сохранён. ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
