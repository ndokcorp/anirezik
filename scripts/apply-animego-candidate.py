"""Validate/apply only a completed, exact AnimeGO candidate. No network calls."""
import json,re,sys,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; C=ROOT/'.cache/animego-full/candidate'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
report=read(C/'src/data/animego-sync-report.json');index=read(C/'src/data/animego-index.json')
assert report['complete'] and not report['error'] and report['pagesProcessed']==report['sitemap']['count']
assert len(index['ids'])==len(set(index['ids'])) and index['ids'] and len(index['ids'])==report['publishedCandidateAnime']
cat={a['shikimoriId']:a for a in read(ROOT/'src/data/catalog.json')['anime']}
for id in index['ids']:
 raw=read(C/f'public/data/video/animego/{id}.json'); a=cat[id];assert raw['shikimoriId']==id and raw['year']==a['year'] and raw['originalTitle']==a['originalTitle'] and raw['format'].lower()==a['kind'];seen=set()
 page=urllib.parse.urlparse(raw['sourceUrl']);assert page.scheme=='https' and page.netloc=='animego.me' and page.path.endswith('-'+str(raw['animegoId']))
 assert raw['entries']
 for row in raw['entries']:
  u=urllib.parse.urlparse(row['embedUrl']);assert u.scheme=='https' and u.netloc=='animego.me' and re.fullmatch(r'/cdn-iframe/[1-9]\d*(?:/[^?#]*)?',u.path) and not u.fragment
  assert all(k=='dubbing' for k in urllib.parse.parse_qs(u.query,keep_blank_values=True))
  assert type(row['episodeNumber']) is int and row['episodeNumber']>0 and re.fullmatch(r'animego:[1-9]\d*',row['translationId']) and row['label'].strip() and '\ufffd' not in row['label']
  key=(row['episodeNumber'],row['translationId']);assert key not in seen;seen.add(key)
print('Validated complete AnimeGO candidate:',len(index['ids']),'anime')
if '--apply' in sys.argv:
 for p in C.rglob('*.json'):
  rel=p.relative_to(C)
  assert str(rel).replace('\\','/') in ['src/data/animego-index.json','src/data/animego-sync-report.json'] or re.fullmatch(r'public/data/video/animego/[1-9]\d*\.json',str(rel).replace('\\','/'))
  target=ROOT/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(p.read_bytes())
 for p in (ROOT/'public/data/video/animego').glob('*.json'):
  if int(p.stem) not in index['ids']:p.unlink()
 for name in ['package.json','package-lock.json']:
  p=ROOT/name;d=read(p);d['version']='0.5.0'
  if name=='package-lock.json':d['packages']['']['version']='0.5.0'
  p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 p=ROOT/'src/data/site-updates.json';news=[n for n in read(p) if n['version']!='0.5.0'];news.insert(0,{'version':'0.5.0','title':'Полный обход каталога AnimeGO','text':f"Обработано {report['pagesProcessed']} страниц AnimeGO. Подключены точные CVH-источники для {len(index['ids'])} аниме; новые первые плееры: {len(report['firstPlayerIds'])}. AniRezik Player и Kodik сохранены. Данные о доступности не означают проверку воспроизведения каждой серии."});p.write_text(json.dumps(news,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
