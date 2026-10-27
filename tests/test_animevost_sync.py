import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('vost_sync', Path(__file__).parents[1] / 'scripts/sync-animevost.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class MatchingTests(unittest.TestCase):
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
