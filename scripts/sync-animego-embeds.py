"""Collect only observed AnimeGO-hosted CVH iframe URLs. No stream extraction or forged Origin/Referer."""
import argparse,datetime,json,time,urllib.request,urllib.parse,urllib.error
from pathlib import Path
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.cache/animego-embeds';CACHE.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--max',type=int,default=100);p.add_argument('--refresh',action='store_true');a=p.parse_args()
if not 1<=a.max<=200: raise ValueError('Request budget 1..200')
report=json.loads((ROOT/'docs/diagnostics/ANIMEGO_0.4.9_RESEARCH.json').read_text(encoding='utf-8'))
targets={r['shikimoriId']:r for r in report['sample']+report['pilots'] if r.get('match')}
statepath=CACHE/'progress.json';state=json.loads(statepath.read_text(encoding='utf-8')) if statepath.exists() else {'responses':{},'requests':0}
if a.refresh: state={'responses':{},'requests':state['requests']}
requests=0
class BudgetStop(Exception): pass
def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8');tmp.replace(path)
def fetch(path):
 global requests
 if path in state['responses']:
  cached=state['responses'][path]
  cached['rows']=[r for r in cached['rows'] if '\ufffd' not in r['label'] and '\ufffd' not in r['embedUrl']]
  return cached
 if requests>=a.max: raise BudgetStop()
 time.sleep(1.5);requests+=1;state['requests']+=1
 req=urllib.request.Request('https://animego.me'+path,headers={'User-Agent':'AniRezik-Compatibility-Research/0.4.9','X-Requested-With':'XMLHttpRequest','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=15) as response:
  if response.url!='https://animego.me'+path: raise ValueError('Unexpected redirect')
  body=json.load(response)
 if body.get('status') not in ['success',True,200,'ok']: raise ValueError('Provider response not successful')
 s=BeautifulSoup(body.get('data',{}).get('content',''),'html.parser')
 eps={}
 for e in s.select('[data-episode-number][data-episode]'):
  n,id=e.get('data-episode-number'),e.get('data-episode')
  if n.isdigit() and id.isdigit() and int(n)>0: eps[n]=id
 rows=[]
 for b in s.select('button[data-player][data-provider-title="CVH"]'):
  raw=b['data-player'];url='https:'+raw if raw.startswith('//') else raw;u=urllib.parse.urlparse(url)
  if u.scheme!='https' or u.netloc!='animego.me' or not u.path.startswith('/cdn-iframe/') or u.fragment: continue
  if not b.get('data-ptranslation') or not b.get('data-translation-title') or '\ufffd' in b['data-translation-title'] or '\ufffd' in url: continue
  # Encode non-ASCII/spaces without changing original parameter values.
  url=urllib.parse.urlunparse(u._replace(path=urllib.parse.quote(u.path,safe='/%:'),query=urllib.parse.quote(u.query,safe='=%&:/' )))
  rows.append({'translationId':'animego:'+b['data-ptranslation'],'label':b['data-translation-title'],'embedUrl':url})
 data={'episodes':eps,'rows':rows};state['responses'][path]=data;atomic(statepath,state);return data
ready={};pending=[];absent=[];failure=None
try:
 for id,t in sorted(targets.items(),key=lambda item:(item[1]['hasCurrentPlayer'],item[0])):
  meta=t['match'];first=fetch('/player/'+str(meta['animegoId']))
  if not first['rows']: absent.append(id);continue
  eps=first['episodes']
  if not eps:
   if t['format']!='MOVIE': pending.append(id);continue
   eps={'1':None}
  entries=[]
  for n,episodeId in sorted(eps.items(),key=lambda x:int(x[0])):
   data=first if int(n)==1 else fetch('/player/videos/'+episodeId)
   for row in data['rows']: entries.append({**row,'episodeNumber':int(n)})
  if not entries: absent.append(id);continue
  ready[id]={'version':1,'shikimoriId':id,'animegoId':meta['animegoId'],'title':t['title'],'originalTitle':t['originalTitle'],'year':t['year'],'format':t['format'],'sourceUrl':meta['url'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'entries':entries}
  print('Complete',id,'episodes',len({e['episodeNumber'] for e in entries}),'voices',len({e['translationId'] for e in entries}))
except BudgetStop: failure='budget'
except Exception as e: failure=type(e).__name__+': '+str(e)[:140]
if not failure:
 for id,data in ready.items(): atomic(ROOT/f'public/data/video/animego/{id}.json',data)
summary={'targets':len(targets),'readyAnime':len(ready),'readyIds':sorted(ready),'withoutHostedCvh':absent,'pendingIds':sorted(set(targets)-set(ready)-set(absent)),'requestsThisRun':requests,'requestsTotal':state['requests'],'stop':failure,'episodeVoiceEntries':sum(len(d['entries']) for d in ready.values())}
atomic(CACHE/'report.json',summary);print(json.dumps(summary));
if not failure: atomic(ROOT/'src/data/animego-index.json',{'version':1,'ids':sorted(ready),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
if failure and failure!='budget': raise SystemExit(1)
