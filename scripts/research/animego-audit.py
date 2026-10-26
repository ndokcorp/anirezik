"""Metadata-only AnimeGO audit. Never calls search/player/stream APIs or copies images.
Research dependency: beautifulsoup4. Application/runtime dependencies are unchanged.
"""
import argparse
import math
import hashlib
import json
import random
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/animego-research'
UA = 'AniRezik-Compatibility-Research/0.4.9'
PILOTS = [54744, 52299, 53397, 1, 64505, 32281, 56838]
TRANS = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
 ['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya']))

def key(text):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD',''.join(TRANS.get(c,c) for c in unicodedata.normalize('NFKC',text.lower()))))

def format_group(a):
    t=a['type'].upper()
    return {'ФИЛЬМ':'MOVIE','ТВ-СЕРИАЛ':'TV','СПЕЦВЫПУСК':'OTHER','TV SPECIAL':'OTHER'}.get(t,t) if t in ['TV','MOVIE','ФИЛЬМ','ТВ-СЕРИАЛ','OVA','ONA'] else 'OTHER'

def stratum(a):
    y=a.get('year') or 0
    period='unknown' if not y else 'before-2000' if y<2000 else '2000-2009' if y<2010 else '2010-2019' if y<2020 else '2020-2023' if y<2024 else '2024-plus'
    return period+'|'+format_group(a)

def sample(catalog, available):
    """50 with/50 without current providers; all nonempty era/format cells represented."""
    selected=[]
    for has in [False,True]:
        cells=defaultdict(list)
        popular=[a for a in catalog if bool(a.get('popular')) and (a['shikimoriId'] in available)==has]
        for a in popular:
            selected.append({**a,'auditStratum':f'{has}|editorial-census|{a["shikimoriId"]}','populationN':1,'sampleN':1,'hasCurrentPlayer':has})
        for a in catalog:
            if not a.get('popular') and (a['shikimoriId'] in available)==has: cells[stratum(a)].append(a)
        # Each cell has >=1. Proportionally allocate the remaining seats.
        quota={k:1 for k in cells};remaining=50-len(popular)-len(cells)
        if remaining<0: raise ValueError('Too many strata')
        while remaining:
            eligible=[k for k in cells if quota[k]<len(cells[k])]
            k=max(eligible,key=lambda k:(len(cells[k])/quota[k],k));quota[k]+=1;remaining-=1
        for k in sorted(cells):
            population=sorted(cells[k],key=lambda a:a['shikimoriId'])
            rng=random.Random('anirezik-0.4.9|'+str(has)+'|'+k)
            for a in rng.sample(population,quota[k]):
                selected.append({**a,'auditStratum':f'{has}|{k}','populationN':len(population),'sampleN':quota[k],'hasCurrentPlayer':has})
    assert len(selected)==100 and len({a['shikimoriId'] for a in selected})==100
    return selected

def atomic(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');tmp.replace(path)

def parse_metadata(content, url):
    from bs4 import BeautifulSoup
    soup=BeautifulSoup(content,'html.parser')
    entity=soup.select_one('.entity')
    title=soup.select_one('.entity__title') or soup.select_one('h1')
    if not entity or not title: raise ValueError('Unrecognized public title page')
    fields={}
    container=soup.select_one('.entity-field')
    children=container.find_all('div',recursive=False) if container else []
    for i in range(0,len(children)-1,2): fields[children[i].get_text(' ',strip=True)]=children[i+1].get_text(' ',strip=True)
    structured=[]
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            obj=json.loads(script.get_text())
            structured.extend(obj if isinstance(obj,list) else [obj])
        except json.JSONDecodeError: pass
    item=next((o for o in structured if isinstance(o,dict) and o.get('@type') in ['TVSeries','Movie']),{})
    dates=re.findall(r'\b(?:19|20)\d{2}\b',fields.get('Выпуск',''))
    year=int(dates[0]) if dates else None
    fmt={'Сериал':'TV','Фильм':'MOVIE','OVA':'OVA','ONA':'ONA','Спецвыпуск':'OTHER','ТВ-спецвыпуск':'OTHER'}.get(fields.get('Тип'))
    names=item.get('alternateName') or []
    if isinstance(names,str): names=[names]
    synonyms=soup.select_one('.entity__title-synonyms')
    if synonyms: names += [s.strip() for s in synonyms.get_text(' ',strip=True).split('/') if s.strip()]
    voicefield=next((children[i+1] for i in range(0,len(children)-1,2) if children[i].get_text(' ',strip=True)=='Озвучка'),None)
    voices=[a.get_text(' ',strip=True) for a in voicefield.select('a')] if voicefield else []
    # No descriptions, images, embed hashes, publisher parameters or media URLs are retained.
    return {'animegoId':int(re.search(r'-(\d+)$',urllib.parse.urlparse(url).path)[1]),'url':url,'title':title.get_text(' ',strip=True),'alternativeNames':names,'year':year,'format':fmt,'declaredEpisodes':item.get('numberOfEpisodes'),'declaredVoices':voices}

def matches(a, m):
    names=[a['title'],a['originalTitle'],a.get('englishTitle') or '',*a.get('aliases',[])]
    target={key(n) for n in names if n}
    remote={key(n) for n in [m['title'],*m['alternativeNames']] if n}
    original={key(n) for n in [a['originalTitle'],a.get('englishTitle') or ''] if n}
    if not m['year'] or a.get('year')!=m['year'] or format_group(a)!=m['format']: return False
    if not (original & remote): return False
    if not target & remote: return False
    marker=lambda ns:{int(m[0] or m[1]) for n in ns for m in re.findall(r"(?:season|сезон|part|часть)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season",n,re.I)}
    ts,rs=marker(names),marker([m["title"],*m["alternativeNames"]])
    if ts and rs and ts!=rs: return False
    # Exact aliases retain season/part numbers; no fuzzy title or missing-season substitution.
    return True

def main():
    p=argparse.ArgumentParser();p.add_argument('--max-requests',type=int,default=15);p.add_argument('--interval',type=float,default=1.5);args=p.parse_args()
    if not 1<=args.max_requests<=100 or args.interval<1.5: p.error('Use budget 1..100 and interval >=1.5')
    bootstrap=0
    for filename,url in [('animego-robots.txt','https://animego.me/robots.txt'),('sitemap-anime.txt','https://animego.me/sitemap.anime.xml')]:
        local=ROOT/'.cache'/filename
        if local.exists(): continue
        if bootstrap>=args.max_requests:
            print(json.dumps({'stage':'public-index','complete':False,'requestsThisRun':bootstrap}));return
        if filename!='animego-robots.txt':
            rp=urllib.robotparser.RobotFileParser();rp.parse((ROOT/'.cache/animego-robots.txt').read_text().splitlines())
            if not rp.can_fetch(UA,url): raise ValueError('Sitemap forbidden by robots')
        time.sleep(args.interval)
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=15) as response:
            content=response.read(3000001)
            if len(content)>3000000 or response.url!=url: raise ValueError('Unexpected public index response')
        local.parent.mkdir(parents=True,exist_ok=True);local.write_bytes(content);bootstrap+=1
    catalog=json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['anime']
    idx=json.loads((ROOT/'src/data/aniliberty-index.json').read_text())['mappings'];available={int(k) for k in idx}|{39535}
    frozen=CACHE/'cohort.json'
    if frozen.exists():
        snapshot=json.loads(frozen.read_text(encoding='utf-8'));cohort=snapshot['cohort'];pilots=snapshot['pilots']
    else:
        cohort=sample(catalog,available)
        pilots=[{**next(a for a in catalog if a['shikimoriId']==id),'hasCurrentPlayer':id in available} for id in PILOTS]
        keep=['id','shikimoriId','title','originalTitle','englishTitle','aliases','year','type','status','popular','auditStratum','populationN','sampleN','hasCurrentPlayer']
        minimal=lambda rows:[{k:a[k] for k in keep if k in a} for a in rows]
        snapshot={'population':len(catalog),'cohort':minimal(cohort),'pilots':minimal(pilots),'inputDigests':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['src/data/catalog.json','src/data/aniliberty-index.json','.cache/sitemap-anime.txt']}}
        atomic(frozen,snapshot);cohort=snapshot['cohort'];pilots=snapshot['pilots']
    if snapshot['inputDigests']['.cache/sitemap-anime.txt']!=hashlib.sha256((ROOT/'.cache/sitemap-anime.txt').read_bytes()).hexdigest():
        raise ValueError('Different sitemap snapshot: keep the old checkpoint and create a separate audit')
    population=snapshot['population']
    urls=[e.text for e in ET.fromstring((ROOT/'.cache/sitemap-anime.txt').read_text()).iter() if e.tag.endswith('}loc')]
    sitemap={}
    for url in urls:
        stem=re.sub(r'-\d+$','',urllib.parse.urlparse(url).path.rsplit('/',1)[-1])
        stem=re.sub(r'-20\d\d-\d\d-\d\d','',stem)
        for k in [key(stem),key(re.sub(r'-[sv]1$','',stem))]: sitemap.setdefault(k,set()).add(url)
    robots=urllib.robotparser.RobotFileParser();robots.parse((ROOT/'.cache/animego-robots.txt').read_text().splitlines())
    path=CACHE/'progress.json';state=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'pages':{},'requests':0}
    unique={a['shikimoriId']:a for a in [*cohort,*pilots]};candidates={}
    for id,a in unique.items():
        result=set()
        for n in [a['title'],a['originalTitle'],a.get('englishTitle') or '',*a.get('aliases',[])]: result |= sitemap.get(key(n),set())
        candidates[id]=sorted(result)
    queue=sorted({u for urls in candidates.values() for u in urls if u not in state['pages']})
    requests=bootstrap;failure=None
    for url in queue:
        if requests>=args.max_requests: break
        if not robots.can_fetch(UA,url): failure='robots-denied';break
        time.sleep(args.interval);requests+=1;state['requests']+=1
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html'}),timeout=15) as response:
                content=response.read(1200000)
                if response.url!=url: raise ValueError('Unexpected redirect; review canonical URL before resuming')
                if b'Just a moment' in content or b'cf-chl-' in content: raise ValueError('Challenge: stopped without bypass')
                state['pages'][url]={'status':response.status,'metadata':parse_metadata(content,url)}
        except Exception as e:
            if isinstance(e,urllib.error.HTTPError) and e.code==404: state['pages'][url]={'status':404}
            else: failure=type(e).__name__+': '+str(e)[:160];state['error']=failure;atomic(path,state);break
        atomic(path,state)
    def record(a):
        cs=candidates[a['shikimoriId']];pages=[state['pages'].get(u) for u in cs];found=[r['metadata'] for r in pages if r and r.get('metadata')];exact=[r for r in found if matches(a,r)]
        return {'shikimoriId':a['shikimoriId'],'title':a['title'],'originalTitle':a['originalTitle'],'year':a.get('year'),'format':format_group(a),'popular':bool(a.get('popular')),'hasCurrentPlayer':a['hasCurrentPlayer'],'stratum':a.get('auditStratum'),'populationN':a.get('populationN'),'sampleN':a.get('sampleN'),'candidateUrls':cs,'pages':found,'state':'ambiguous' if len(exact)>1 else 'metadata-confirmed' if len(exact)==1 else 'pending' if any(r is None for r in pages) else 'needs-review' if found else 'not-located-in-sitemap','match':exact[0] if len(exact)==1 else None,'embedAllowed':None,'playbackTested':False}
    sample_rows=[record(a) for a in cohort];pilot_rows=[record(a) for a in pilots]
    summary={'sampleSize':100,'sitemapUrls':len(urls),'indexLookups':100,'searchEndpointRequests':0,'metadataPageRequestsTotal':state['requests'],'remainingMetadataPages':sum(u not in state['pages'] for u in {u for urls in candidates.values() for u in urls}),'states':dict(Counter(r['state'] for r in sample_rows)),'pageFound':sum(bool(r['pages']) for r in sample_rows),'declaredVoicesPresent':sum(any(m['declaredVoices'] for m in r['pages']) for r in sample_rows),'approvedEmbeds':0,'playbackTested':0,'playbackConfirmed':0,'actualVideoCoverageEstimate':None,'failure':failure,'caveat':'Sitemap discovery is incomplete and slug-based; not-located is UNKNOWN, not absent. This is metadata detection, not permitted embed/video coverage. No population video estimate or false zero percent.'}
    report={'version':'0.4.9-research','population':population,'sourceInputDigests':snapshot['inputDigests'],'sampling':'50 with current provider / 50 without; census of all six editorial-popular flags plus deterministic probability sampling of non-popular titles within all nonempty era x format cells (minimum one). Editorial flags are not external viewing/popularity ranks. Unequal probabilities: raw sample rate is not catalog coverage.','summary':summary,'pilots':pilot_rows,'sample':sample_rows}
    weights=[r['populationN']/population/r['sampleN'] for r in sample_rows]
    detected=sum(w for w,r in zip(weights,sample_rows) if r['state']=='metadata-confirmed')
    bound=math.sqrt(math.log(40)/2*sum(w*w for w in weights))
    report['metadataDetectionOnly']={'weightedRate':detected,'conservative95Interval':[max(0,detected-bound),min(1,detected+bound)],'method':'Weighted Hoeffding bound for stratified sampling without replacement; detects exact metadata through this sitemap method only, not actual AnimeGO presence or playable/authorized video coverage. False negatives not corrected.'}
    atomic(CACHE/'report.json',report);print(json.dumps(summary));print('Pilot states:',[(r['shikimoriId'],r['state'],r['match']['animegoId'] if r['match'] else None) for r in pilot_rows])

if __name__=='__main__': main()
