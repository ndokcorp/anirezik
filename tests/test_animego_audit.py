import importlib.util
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('animego_audit',ROOT/'scripts/research/animego-audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class AuditTests(unittest.TestCase):
    def test_transliteration_keeps_cyrillic_short_i(self):
        self.assertEqual(audit.key('Ковбой Бибоп'),audit.key('kovboy-bibop'))
        self.assertEqual(audit.key('Твоё имя'),audit.key('tvoe-imya'))
    def test_cohort_is_reproducible_balanced_and_weighted(self):
        catalog=json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['anime']
        available={int(k) for k in json.loads((ROOT/'src/data/aniliberty-index.json').read_text())['mappings']}|{39535}
        rows=audit.sample(catalog,available)
        self.assertEqual([r['id'] for r in rows],[r['id'] for r in audit.sample(catalog,available)])
        self.assertEqual(len({r['id'] for r in rows}),100)
        self.assertEqual(sum(r['hasCurrentPlayer'] for r in rows),50)
        self.assertEqual(sum(bool(r.get('popular')) for r in rows),sum(bool(r.get('popular')) for r in catalog))
        self.assertAlmostEqual(sum(r['populationN']/len(catalog)/r['sampleN'] for r in rows),1)
        self.assertEqual({audit.stratum(a) for a in catalog},{audit.stratum(a) for a in rows})
    def test_only_metadata_retained_no_stream_or_images(self):
        html='''<div class="entity"><h1 class="entity__title">Example</h1><div class="entity-field"><div>Тип</div><div>Фильм</div><div>Выпуск</div><div>26 августа 2020</div><div>Озвучка</div><div><a>Studio</a></div></div><script type="application/ld+json">{"@type":"Movie","alternateName":"Example","image":"https://example.test/poster","description":"not retained","contentUrl":"https://example.test/stream"}</script></div>'''
        row=audit.parse_metadata(html,'https://animego.me/anime/example-17')
        self.assertEqual(row['animegoId'],17);self.assertEqual(row['year'],2020)
        self.assertEqual(row['format'],'MOVIE');self.assertEqual(row['declaredVoices'],['Studio'])
        self.assertNotIn('example.test',json.dumps(row));self.assertNotIn('not retained',json.dumps(row))
        with self.assertRaises(ValueError): audit.parse_metadata('challenge','https://animego.me/anime/example-17')
    def test_seasons_year_format_and_original_are_all_required(self):
        a={'title':'Example Season 2','originalTitle':'Example 2','aliases':[],'type':'TV','year':2024}
        m={'title':'Example Season 2','alternativeNames':['Example 2'],'format':'TV','year':2024}
        self.assertTrue(audit.matches(a,m))
        for bad in [{**m,'year':2023},{**m,'format':'MOVIE'},{**m,'alternativeNames':[]},{**m,'title':'Example Season 1'}]:
            self.assertFalse(audit.matches(a,bad))
        self.assertFalse(audit.matches(a,{**m,'year':None}))

if __name__=='__main__': unittest.main()
