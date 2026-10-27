import importlib.util
import unittest
import tempfile
import urllib.error
from unittest.mock import patch
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('vost_sync', Path(__file__).parents[1] / 'scripts/sync-animevost.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class MatchingTests(unittest.TestCase):
    def test_incremental_keeps_full_scan_error_and_unseen_rows(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit): return json.dumps({'state': {'status':'ok'},'data':[{'id':2,'title':'New','year':'2026','type':'ТВ','series':"{'1 серия':'x'}"}]}).encode()
        with tempfile.TemporaryDirectory() as folder, patch.object(sync,'CACHE',Path(folder)), patch.object(sync.urllib.request,'urlopen',return_value=Response()) as request, patch.object(sync.time,'sleep'):
            state={'rows':{'1':{'id':1}},'complete':False,'error':{'type':'ValueError','page':91},'nextPage':91}
            sync.incremental_refresh(state,Path(folder)/'checkpoint.json',1,2)
            self.assertIn('1',state['rows']);self.assertIn('2',state['rows'])
            self.assertEqual(state['error']['page'],91);self.assertFalse(state['complete']);self.assertEqual(request.call_count,1)
    def test_incremental_access_error_checkpoint_prevents_retry(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(sync,'CACHE',Path(folder)), patch.object(sync.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('https://api.animevost.org',429,'limit',{'Retry-After':'3600'},None)) as request:
            state={'rows':{},'complete':False,'error':None,'nextPage':1}
            with self.assertRaises(SystemExit):sync.incremental_refresh(state,Path(folder)/'checkpoint.json',2,2)
            self.assertEqual(state['incremental']['error']['retryAfter'],'3600')
            with self.assertRaises(SystemExit):sync.incremental_refresh(state,Path(folder)/'checkpoint.json',2,2)
            self.assertEqual(request.call_count,1)
    def test_explicit_singleton_does_not_invent_tv_episodes(self):
        for kind, label in [('OVA', 'ОВА'), ('ONA', 'ONA')]:
            self.assertEqual(sync.episode_numbers({'type': kind, 'series': repr({label: 'id'})}), [1])
            self.assertEqual(sync.episode_numbers({'type': 'ТВ', 'series': repr({label: 'id'})}), [])
            self.assertEqual(sync.episode_numbers({'type': kind, 'series': repr({label: 'id', 'Трейлер': 'other'})}), [])
        self.assertFalse(sync.explicit_single_label({'type': 'OVA', 'series': '{"1 серия":"id"}'}))
    def test_seasons_films_remakes_and_ambiguity(self):
        catalog = [{'shikimoriId': 1, 'title': 'Example', 'originalTitle': 'Example', 'year': 2024, 'kind': 'tv', 'episodes': 2},
                   {'shikimoriId': 2, 'title': 'Example 2', 'year': 2025, 'kind': 'tv'},
                   {'shikimoriId': 3, 'title': 'Example', 'year': 2024, 'kind': 'movie'}]
        row = {'id': 10, 'title': 'Example [1-2 из 2]', 'year': '2024', 'type': 'ТВ', 'series': "{'1 серия':'x','2 серия':'y'}"}
        matches, _ = sync.match_catalog([row], catalog)
        self.assertEqual(list(matches), ['1'])
        self.assertEqual(matches['1']['episodeNumbers'], [1, 2])
        self.assertEqual(sync.match_catalog([{**row, 'year': '2023'}], catalog)[0], {})
        self.assertEqual(sync.match_catalog([row], catalog + [{**catalog[0], 'shikimoriId': 4}])[0], {})
        self.assertEqual(sync.match_catalog([row, {**row, 'id': 11}], catalog)[0], {})
        merged = {**row, 'series': "{'1 серия':'x','2 серия':'y','3 серия':'z'}"}
        self.assertEqual(sync.match_catalog([merged], catalog)[0], {})
        self.assertEqual(sync.match_catalog([merged], catalog)[1][0]['reason'], 'episode-range-conflict')


if __name__ == '__main__':
    unittest.main()
