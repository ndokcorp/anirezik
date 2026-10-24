import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShikimoriApi } from '../src/lib/providers/shikimori/api.ts';
import { ANIMES_QUERY } from '../src/lib/providers/shikimori/queries.ts';
import { parseAnimeResponse } from '../src/lib/providers/shikimori/mapper.ts';
test('необязательный живой запрос к официальному API', async () => {
  const api = new ShikimoriApi({ base: process.env.SHIKIMORI_BASE_URL || 'https://shikimori.io' });
  const rows = parseAnimeResponse(await api.query(ANIMES_QUERY, { ids: '52299', limit: 1 }));
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].id), 52299);
  console.log('Live Shikimori OK:', rows[0].name);
});
