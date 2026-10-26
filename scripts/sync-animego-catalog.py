"""Resumable, metadata-only catalog/observed-iframe sync. No media extraction."""
import argparse, collections, datetime, gzip, hashlib, importlib.util, json, os, re, sqlite3, time
import urllib.request, urllib.error, urllib.parse, urllib.robotparser, xml.etree.ElementTree as ET
from pathlib import Path
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.cache/animego-full'; CACHE.mkdir(parents=True,exist_ok=True)
SPEC=importlib.util.spec_from_file_location('audit',ROOT/'scripts/research/animego-audit.py')
audit=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(audit)
UA='AniRezik-Catalog-Sync/0.5.0'

def dump(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True); tmp=path.with_suffix(path.suffix+'.tmp')
 tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8'); tmp.replace(path)

def player_data(body):
 if body.get('status') not in ['success',True,200,'ok']: raise ValueError('Unsuccessful player response')
 s=BeautifulSoup(body.get('data',{}).get('content',''),'html.parser'); eps={}; rows=[]; providers=set()
 for e in s.select('[data-episode-number][data-episode]'):
  n,i=e.get('data-episode-number',''),e.get('data-episode','')
  if n.isdigit() and i.isdigit() and int(n)>0:
   if n in eps and eps[n]!=i: raise ValueError('Conflicting episode identity')
   eps[n]=i
 for b in s.select('button[data-player][data-provider-title]'):
  provider=b['data-provider-title']; providers.add(provider)
  if provider!='CVH': continue
  raw=b['data-player']; raw='https:'+raw if raw.startswith('//') else raw; u=urllib.parse.urlparse(raw)
  label=b.get('data-translation-title',''); tid=b.get('data-ptranslation','')
  if u.scheme!='https' or u.netloc!='animego.me' or not re.fullmatch(r'/cdn-iframe/[1-9]\d*(?:/[^?#]*)?',u.path) or u.fragment or any(k!='dubbing' for k in urllib.parse.parse_qs(u.query,keep_blank_values=True)): continue
  if not tid.isdigit() or int(tid)<1 or not label.strip() or len(label)>200 or '\ufffd' in label+raw: continue
  encoded=urllib.parse.urlunparse(u._replace(path=urllib.parse.quote(u.path,safe='/%:'),query=urllib.parse.quote(u.query,safe='=%&:/')))
  rows.append({'translationId':'animego:'+tid,'label':label,'embedUrl':encoded})
 seen={}
 for row in rows:
  if row['translationId'] in seen and seen[row['translationId']]!=row: raise ValueError('Conflicting translation identity')
  seen[row['translationId']]=row
 return {'episodes':eps,'rows':list(seen.values()),'providers':sorted(providers)}

class Budget(Exception): pass
class Sync:
 def __init__(self,budget):
  self.budget=budget;self.used=0;self.last=0
  self.db=sqlite3.connect(CACHE/'state.sqlite'); self.db.row_factory=sqlite3.Row
  self.db.executescript('CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS pages(url TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT "pending",meta TEXT,shiki INTEGER,reason TEXT); CREATE TABLE IF NOT EXISTS responses(path TEXT PRIMARY KEY,data TEXT,checked TEXT); CREATE TABLE IF NOT EXISTS ready(shiki INTEGER PRIMARY KEY,data TEXT);')
  self.catalog=json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['anime']; self.byid={a['shikimoriId']:a for a in self.catalog}; self.names=collections.defaultdict(set)
  for a in self.catalog:
   for n in [a['originalTitle'],a.get('englishTitle') or '',*a.get('aliases',[])]:
    if n and audit.key(n): self.names[audit.key(n)].add(a['shikimoriId'])
  digest=hashlib.sha256(json.dumps(self.catalog,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
  old=self.config('catalogDigest')
  kind=self.config('catalogDigestKind')
  if old and kind=='semantic-v1' and old!=digest: raise ValueError('Catalog changed; review checkpoint before resuming')
  if kind!='semantic-v1':self.setconfig('matchingVersion',0)
  self.setconfig('catalogDigest',digest);self.setconfig('catalogDigestKind','semantic-v1')
  if not self.config('baseline'):
   baseline=set(map(int,json.loads((ROOT/'src/data/aniliberty-index.json').read_text())['mappings']))|{39535}|set(json.loads((ROOT/'src/data/animego-index.json').read_text())['ids'])
   self.setconfig('baseline',sorted(baseline))
   self.setconfig('initialAnimeGoIds',json.loads((ROOT/'src/data/animego-index.json').read_text())['ids'])
  self.db.commit()
 def config(self,key):
  row=self.db.execute('SELECT value FROM config WHERE key=?',(key,)).fetchone();return json.loads(row[0]) if row else None
 def setconfig(self,key,value): self.db.execute('INSERT OR REPLACE INTO config VALUES(?,?)',(key,json.dumps(value)))
 def get(self,path,json_response=False):
  headers={'User-Agent':UA,'Accept':'application/json' if json_response else 'text/html'}
  if json_response: headers['X-Requested-With']='XMLHttpRequest'
  for attempt in range(3):
   if self.used>=self.budget: raise Budget()
   time.sleep(max(0,1.5-(time.monotonic()-self.last)));self.last=time.monotonic();self.used+=1
   try:
    with urllib.request.urlopen(urllib.request.Request('https://animego.me'+path,headers=headers),timeout=20) as r:
     if r.url!='https://animego.me'+path: raise ValueError('Unexpected redirect: manual review required')
     raw=r.read(3000001)
     if len(raw)>3000000 or b'cf-chl-' in raw or b'Just a moment' in raw: raise ValueError('Challenge or oversized response; no bypass')
    return json.loads(raw) if json_response else raw.decode('utf-8')
   except urllib.error.HTTPError as e:
    if e.code not in [500,502,503,504] or attempt==2:raise
   except (urllib.error.URLError,TimeoutError):
    if attempt==2:raise
   time.sleep(5*(attempt+1))
 def initialize(self):
  if self.config('sitemap'): return
  robots_path=ROOT/'.cache/animego-robots.txt'; sitemap_path=ROOT/'.cache/sitemap-anime.txt'
  robots=robots_path.read_text(encoding='utf-8') if robots_path.exists() else self.get('/robots.txt')
  rp=urllib.robotparser.RobotFileParser();rp.parse(robots.splitlines())
  if not rp.can_fetch(UA,'https://animego.me/sitemap.anime.xml'): raise ValueError('Robots deny sitemap')
  content=sitemap_path.read_text(encoding='utf-8') if sitemap_path.exists() else self.get('/sitemap.anime.xml')
  urls=sorted({e.text for e in ET.fromstring(content).iter() if e.tag.endswith('}loc') and e.text})
  if not urls: raise ValueError('Empty sitemap')
  for u in urls:
   p=urllib.parse.urlparse(u)
   if p.scheme!='https' or p.netloc!='animego.me' or not re.fullmatch(r'/anime/[a-z0-9-]+-[1-9]\d*',p.path) or not rp.can_fetch(UA,u): raise ValueError('Unapproved sitemap entry')
   self.db.execute('INSERT OR IGNORE INTO pages(url) VALUES(?)',(u,))
  self.setconfig('robots',robots); self.setconfig('sitemap',{'count':len(urls),'digest':hashlib.sha256(content.encode()).hexdigest(),'at':self.now()})
  # Reuse only previously observed metadata, not guesses from slugs.
  research=ROOT/'.cache/animego-research/progress.json'
  if research.exists():
   for u,r in json.loads(research.read_text(encoding='utf-8')).get('pages',{}).items():
    if r.get('metadata'): self.accept_metadata(u,r['metadata'])
  previous=ROOT/'.cache/animego-embeds/progress.json'
  if previous.exists():
   for path,r in json.loads(previous.read_text(encoding='utf-8')).get('responses',{}).items():
    r['rows']=[v for v in r['rows'] if '\ufffd' not in v['label']+v['embedUrl']]
    self.db.execute('INSERT OR IGNORE INTO responses VALUES(?,?,?)',(path,json.dumps(r,ensure_ascii=False),self.now()))
  self.db.commit()
 def now(self):return datetime.datetime.now(datetime.timezone.utc).isoformat()
 def accept_metadata(self,url,meta):
  candidates=set()
  for n in [meta['title'],*meta['alternativeNames']]: candidates|=self.names.get(audit.key(n),set())
  def exact_match(a):
   remote={audit.key(n) for n in [meta['title'],*meta['alternativeNames']] if n and audit.key(n)}
   originals={audit.key(n) for n in [a['originalTitle'],a.get('englishTitle') or ''] if n and audit.key(n)}
   if not remote & originals:return False
   marker=lambda ns:{int(m[0] or m[1]) for n in ns for m in re.findall(r'(?:season|сезон|part|часть)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season',n,re.I)}
   ts=marker([a['title'],a['originalTitle'],a.get('englishTitle') or '',*a.get('aliases',[])])
   rs=marker([meta['title'],*meta['alternativeNames']])
   if ts and ts!=rs or rs and not ts and rs!={1}:return False
   return meta['format'] in ['TV','MOVIE','OVA','ONA'] and audit.matches(a,meta)
  exact=[i for i in candidates if exact_match(self.byid[i])]
  status='matched' if len(exact)==1 else 'review' if candidates else 'unmatched'
  reason=None if len(exact)==1 else 'ambiguous-or-conflicting-metadata' if candidates else 'no-exact-name'
  self.db.execute('UPDATE pages SET status=?,meta=?,shiki=?,reason=? WHERE url=?',(status,json.dumps(meta,ensure_ascii=False),exact[0] if len(exact)==1 else None,reason,url))
 def response(self,path):
  row=self.db.execute('SELECT data FROM responses WHERE path=?',(path,)).fetchone()
  if row:return json.loads(row[0])
  try:data=player_data(self.get(path,True))
  except urllib.error.HTTPError as e:
   if e.code not in [404,410]:raise
   data={'episodes':{},'rows':[],'providers':[],'missing':True}
  self.db.execute('INSERT INTO responses VALUES(?,?,?)',(path,json.dumps(data,ensure_ascii=False),self.now()));self.db.commit();return data
 def run(self):
  self.initialize()
  # All metadata first: duplicate season/title mappings are detected before activating sources.
  for row in self.db.execute('SELECT url FROM pages WHERE status="pending" ORDER BY url').fetchall():
   try: meta=audit.parse_metadata(self.get(urllib.parse.urlparse(row['url']).path),row['url']); self.accept_metadata(row['url'],meta)
   except urllib.error.HTTPError as e:
    if e.code in [404,410]: self.db.execute('UPDATE pages SET status="not-found",reason=? WHERE url=?',(str(e.code),row['url']))
    else:raise
   except ValueError as e:
    if 'Unrecognized public title page' in str(e): self.db.execute('UPDATE pages SET status="review",reason="unrecognized-page" WHERE url=?',(row['url'],))
    else:raise
   self.db.commit()
   if self.used%25==0: print(json.dumps({'stage':'metadata','requests':self.used,'processed':self.db.execute('SELECT count(*) FROM pages WHERE status!="pending"').fetchone()[0]}),flush=True)
  if self.config('matchingVersion')!=2:
   for row in self.db.execute('SELECT url,meta FROM pages WHERE meta IS NOT NULL').fetchall():self.accept_metadata(row['url'],json.loads(row['meta']))
   self.setconfig('matchingVersion',2);self.db.commit()
  duplicates=[r[0] for r in self.db.execute('SELECT shiki FROM pages WHERE shiki IS NOT NULL GROUP BY shiki HAVING count(*)>1')]
  for i in duplicates:self.db.execute('UPDATE pages SET status="review",reason="multiple-pages-for-shikimori-id" WHERE shiki=?',(i,))
  self.db.commit(); baseline=set(self.config('baseline'))
  queue=self.db.execute('SELECT * FROM pages WHERE status="matched"').fetchall()
  for row in sorted(queue,key=lambda r:(r['shiki'] in baseline,r['shiki'])):
   m=json.loads(row['meta']);i=row['shiki'];a=self.byid[i]
   first=self.response('/player/'+str(m['animegoId']))
   eps=first['episodes']
   if not eps:
    if m['format']=='MOVIE':eps={'1':None}
    else:self.db.execute('UPDATE pages SET status=?,reason="episode-list-unavailable" WHERE url=?',('no-cvh' if first.get('missing') else 'review',row['url']));self.db.commit();continue
   entries=[]
   for n,episodeid in sorted(eps.items(),key=lambda p:int(p[0])):
    data=first if int(n)==1 else self.response('/player/videos/'+episodeid)
    entries.extend({**v,'episodeNumber':int(n)} for v in data['rows'])
   if not entries:
    self.db.execute('UPDATE pages SET status="no-cvh" WHERE url=?',(row['url'],));self.db.commit();continue
   output={'version':1,'shikimoriId':i,'animegoId':m['animegoId'],'title':a['title'],'originalTitle':a['originalTitle'],'year':a['year'],'format':m['format'],'sourceUrl':m['url'],'checkedAt':self.now(),'entries':entries}
   self.db.execute('INSERT OR REPLACE INTO ready VALUES(?,?)',(i,json.dumps(output,ensure_ascii=False)))
   self.db.execute('UPDATE pages SET status="ready" WHERE url=?',(row['url'],));self.db.commit()
   print(json.dumps({'stage':'episodes','id':i,'episodes':len({e['episodeNumber'] for e in entries}),'voices':len({e['translationId'] for e in entries}),'requests':self.used}),flush=True)
 def report(self,error=None):
  counts=dict(self.db.execute('SELECT status,count(*) FROM pages GROUP BY status').fetchall()); ready=[json.loads(r[0]) for r in self.db.execute('SELECT data FROM ready')]
  initial=self.config('initialAnimeGoIds') or []; baseline=set(self.config('baseline') or [])
  complete=bool(counts) and not counts.get('pending',0) and not counts.get('matched',0) and not error
  result={'version':'0.5.0','sitemap':self.config('sitemap'),'pagesProcessed':sum(v for k,v in counts.items() if k!='pending'),'states':counts,'metadataMatched':sum(v for k,v in counts.items() if k in ['matched','ready','no-cvh']),'readyAnime':len(ready),'readyIds':sorted(r['shikimoriId'] for r in ready),'firstPlayerIds':sorted(r['shikimoriId'] for r in ready if r['shikimoriId'] not in baseline),'episodeVoiceEntries':sum(len(r['entries']) for r in ready),'episodes':sum(len({e['episodeNumber'] for e in r['entries']}) for r in ready),'voiceOptions':sum(len({e['translationId'] for e in r['entries']}) for r in ready),'initialAnimeGoIds':initial,'review': [dict(r) for r in self.db.execute('SELECT url,shiki,reason FROM pages WHERE status="review"')], 'requestsThisBatch':self.used,'complete':complete,'error':error,'playbackTested':3,'providersEnabled':['CVH through AnimeGO iframe'],'checkedAt':self.now()}
  result['baselinePublishedAnimeGo']=len(initial)
  result['baselineConfiguredAnime']=len(baseline)
  previous=[json.loads(p.read_text(encoding='utf-8')) for p in (ROOT/'public/data/video/animego').glob('*.json') if int(p.stem) in initial]
  oldeps={(r['shikimoriId'],e['episodeNumber']) for r in previous for e in r['entries']}
  oldvoices={(r['shikimoriId'],e['translationId']) for r in previous for e in r['entries']}
  result['newEpisodes']=len({(r['shikimoriId'],e['episodeNumber']) for r in ready for e in r['entries']}-oldeps)
  result['newVoiceOptions']=len({(r['shikimoriId'],e['translationId']) for r in ready for e in r['entries']}-oldvoices)
  providers=collections.Counter()
  for response in self.db.execute('SELECT data FROM responses WHERE path GLOB "/player/[0-9]*" AND path NOT LIKE "/player/videos/%"'):
   providers.update(json.loads(response[0]).get('providers',[]))
  result['observedProviderMenus']=dict(providers)
  dump(CACHE/'report.json',result)
  if complete:
   candidate=CACHE/'candidate'
   # Completed revalidation may withdraw revoked/mismatched old entries; failures never publish.
   ids=set()
   for r in ready: ids.add(r['shikimoriId']);dump(candidate/f"public/data/video/animego/{r['shikimoriId']}.json",r)
   result['publishedCandidateAnime']=len(ids);dump(candidate/'src/data/animego-index.json',{'version':1,'ids':sorted(ids),'checkedAt':self.now()});dump(candidate/'src/data/animego-sync-report.json',result)
  out=os.environ.get('GITHUB_OUTPUT')
  if out:
   with open(out,'a',encoding='utf-8') as f:f.write('complete='+str(complete).lower()+'\ncan_continue='+str(not complete and not error).lower()+'\n')
  print(json.dumps({k:v for k,v in result.items() if k not in ['readyIds','review','firstPlayerIds']}),flush=True)
  return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--max-requests',type=int,default=300);a=p.parse_args()
 if not 1<=a.max_requests<=500: p.error('budget 1..500')
 sync=Sync(a.max_requests);error=None
 try:sync.run()
 except Budget:pass
 except Exception as e:error=type(e).__name__+': '+str(e)[:180]
 finally:sync.db.commit();sync.report(error);sync.db.close()
 if error:raise SystemExit(1)
if __name__=='__main__':main()
