"""Public AniLiberty metadata audit; signed media URLs are never written to reports."""
import json,time,re,urllib.request,urllib.parse,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'.cache/provider-review';OUT.mkdir(parents=True,exist_ok=True)
ids=json.loads((ROOT/'docs/diagnostics/ANIMEPARSERS_COHORT_2026-10-27.json').read_text())['ids']
cat={a['shikimoriId']:a for a in json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['anime']}
index=json.loads((ROOT/'src/data/aniliberty-index.json').read_text())['mappings'];rights=json.loads((ROOT/'src/data/video-rights.json').read_text())
report={'rows':[],'requests':0,'source':'https://anilibria.top/api/v1','mediaUrlsPersisted':False};rawby={};headers={};last=0
fields='id,year,name,type,shikimori,mal,is_blocked_by_geo,is_blocked_by_copyrights,updated_at,episodes.id,episodes.ordinal,episodes.duration,episodes.hls_480,episodes.hls_720,episodes.hls_1080'
def get(path):
 global last
 time.sleep(max(0,1.5-(time.monotonic()-last)));last=time.monotonic();report['requests']+=1
 request=urllib.request.Request(report['source']+path,headers={'User-Agent':'AniRezik-Permitted-Metadata-Audit/0.5.0','Accept':'application/json'})
 with urllib.request.urlopen(request,timeout=25) as response:
  body=response.read(8_000_001);assert len(body)<8_000_000
  headers.update({k.lower():v for k,v in response.headers.items() if k.lower() in ['access-control-allow-origin','cache-control','vary']});return json.loads(body)
known={id:index[str(id)]['releaseId'] for id in ids if str(id) in index}
try:
 query=urllib.parse.urlencode({'ids':','.join(map(str,known.values())),'limit':50,'include':fields})
 result=get('/anime/releases/list?'+query);rows=result.get('data',[]) if isinstance(result,dict) else result
 for row in rows:rawby[row['id']]=row
 for id in ids:
  a=cat[id];r=rawby.get(known.get(id));queries=[]
  if r is None:
   terms=[a['originalTitle']]
   if id==54744:terms+=['Alya Sometimes Hides Her Feelings in Russian','Roshidere']
   candidates=[]
   for term in terms:
    result=get('/app/search/releases?'+urllib.parse.urlencode({'query':term,'include':fields}));queries.append({'query':term,'returned':len(result) if isinstance(result,list) else None})
    if isinstance(result,list):candidates.extend(result)
   exact={r['id']:r for r in candidates if str((r.get('shikimori') or {}).get('id'))==str(id)}
   if len(exact)==1:r=next(iter(exact.values()))
  if r is None:report['rows'].append({'shikimoriId':id,'state':'no-exact-release','queries':queries});continue
  expected={'movie':'MOVIE','tv':'TV','ova':'OVA','ona':'ONA','special':'SPECIAL','tv_special':'SPECIAL'}.get(a['kind'])
  exact=str((r.get('shikimori') or {}).get('id'))==str(id) and r.get('year')==a['year'] and r.get('type',{}).get('value')==expected
  eps=r.get('episodes',[]);safe=[];outside=set()
  for e in eps:
   qualities=[]
   for field in ['hls_480','hls_720','hls_1080']:
    value=e.get(field)
    if not value:continue
    u=urllib.parse.urlparse(value)
    if 'https://'+u.netloc in rights['allowedPlaybackOrigins'] and u.scheme=='https':qualities.append(field[4:])
    else:outside.add(u.hostname)
   if qualities:safe.append({'number':e.get('ordinal'),'qualities':qualities,'duration':e.get('duration')})
  geo=r.get('is_blocked_by_geo');copyright=r.get('is_blocked_by_copyrights')
  state='available-metadata' if exact and geo is False and copyright is False and safe else 'restricted-or-unverified'
  report['rows'].append({'shikimoriId':id,'releaseId':r['id'],'state':state,'exactIdYearType':exact,'title':r.get('name',{}).get('main'),'year':r.get('year'),'type':r.get('type',{}).get('value'),'isBlockedByGeo':geo,'isBlockedByCopyrights':copyright,'voice':'AniLibria','episodes':safe,'reportedEpisodes':len(eps),'outsidePlaybackAllowlistHosts':sorted(h for h in outside if h),'queries':queries})
 report['apiResponseHeaders']=headers
except urllib.error.HTTPError as e:report['stop']='http-'+str(e.code)
except Exception as e:report['stop']=type(e).__name__
(OUT/'aniliberty.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'ids':len(report['rows']),'requests':report['requests'],'states':{s:sum(r['state']==s for r in report['rows']) for s in {r['state'] for r in report['rows']}},'stop':report.get('stop')}))
