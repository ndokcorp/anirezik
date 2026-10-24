import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { syncCatalog } from '../src/lib/providers/shikimori/sync.ts';
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
    maxTitles: Number(args.find((arg) => arg.startsWith('--target='))?.slice(9) || 3000),
    ids,
    editorialDescriptions: Object.fromEntries(
      Object.entries(editorial).map(([id, item]) => [id, item.description]),
    ),
    maxAgeMs: args.includes('--force') ? 0 : undefined,
  };
  const snapshot = args.includes('--full')
    ? await syncFullCatalog({ ...config, reportFile: resolve('src/data/catalog-coverage.json') })
    : await syncCatalog(config);
  console.log(
    `Shikimori: сохранено ${snapshot.anime.length} аниме; ${snapshot.fetchedAt}. Постеры и описания API не публикуются без подтверждённых прав.`,
  );
} catch (error) {
  console.error(
    `Обновление не выполнено. Предыдущий каталог сохранён. ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
