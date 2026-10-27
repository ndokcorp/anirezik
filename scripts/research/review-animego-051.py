"""Offline release gate: existing exact caches plus observed browser playback evidence."""
import argparse, datetime, importlib.util, json, re, sqlite3, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/animego-051'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    cli = argparse.ArgumentParser(); cli.add_argument('--apply', action='store_true'); args = cli.parse_args()
    candidates = read(CACHE / 'candidates.json'); evidence = read(CACHE / 'results.json')
    assert len(candidates) == 73 and len({c['shikimoriId'] for c in candidates}) == 73
    catalog = {a['shikimoriId']: a for a in read(ROOT / 'src/data/catalog.json')['anime']}
    spec = importlib.util.spec_from_file_location('audit', ROOT / 'scripts/research/animego-audit.py')
    audit = importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)
    db = sqlite3.connect('file:' + str(ROOT / '.cache/animego-full/state.sqlite').replace('\\', '/') + '?mode=ro', uri=True)
    old_ids = set(read(ROOT / 'src/data/animego-index.json')['ids'])
    configured_ids = old_ids | set(map(int, read(ROOT / 'src/data/aniliberty-index.json')['mappings'])) | {39535}
    baseline_labels = {e['label'] for i in old_ids for e in read(ROOT / f'public/data/video/animego/{i}.json')['entries']}
    reports = []; selected = []; proof_count = 0
    for c in candidates:
        i = c['shikimoriId']; raw = c['raw']; anime = catalog[i]
        pages = db.execute('SELECT meta,status FROM pages WHERE shiki=?', (i,)).fetchall()
        assert len(pages) == 1 and pages[0][1] == 'ready' and audit.matches(anime, json.loads(pages[0][0]))
        meta = json.loads(pages[0][0])
        local_names = [anime['title'], anime['originalTitle'], anime.get('englishTitle') or '', *anime.get('aliases', [])]
        remote_names = [meta['title'], *meta['alternativeNames']]
        nonempty = lambda ns: {audit.key(n) for n in ns if n and audit.key(n)}
        assert nonempty(remote_names) & nonempty([anime['originalTitle'], anime.get('englishTitle') or ''])
        marker = lambda ns: {int(m[0] or m[1]) for n in ns for m in re.findall(r'(?:season|сезон|part|часть)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season', n, re.I)}
        ts, rs = marker(local_names), marker(remote_names)
        assert not (ts and ts != rs or rs and not ts and rs != {1})
        assert raw['shikimoriId'] == i and raw['year'] == anime['year'] and raw['format'].lower() == anime['kind'] and raw['originalTitle'] == anime['originalTitle']
        seen = set()
        for e in raw['entries']:
            u = urllib.parse.urlparse(e['embedUrl']); key = (e['episodeNumber'], e['translationId'])
            assert u.scheme == 'https' and u.netloc == 'animego.me' and not u.fragment and re.fullmatch(r'/cdn-iframe/[1-9]\d*(?:/[^?#]*)?', u.path)
            assert all(k == 'dubbing' for k in urllib.parse.parse_qs(u.query, keep_blank_values=True))
            assert type(e['episodeNumber']) is int and e['episodeNumber'] > 0 and re.fullmatch(r'animego:[1-9]\d*', e['translationId']) and key not in seen
            seen.add(key)
        proofs = [p for p in evidence if p['id'] == i]; allowed = set()
        for p in proofs:
            assert p['translationId'] in {e['translationId'] for e in raw['entries']}
            if p['status'] == 'played':
                if 'episodeNumber' in p:
                    assert any(e['translationId'] == p['translationId'] and e['episodeNumber'] == p['episodeNumber'] for e in raw['entries'])
                m = p['metrics']; assert m['time'] > 2 and m['duration'] > 60 and m['width'] > 0 and m['height'] > 0 and m['ready'] >= 2
                allowed.add(p['translationId']); proof_count += 1
        status = 'verified-playback' if allowed else proofs[0]['status'] if proofs else 'unverified-player'
        reports.append({'shikimoriId': i, 'title': c['title'], 'year': c['year'], 'format': c['format'], 'sourceUrl': raw['sourceUrl'], 'metadata': 'exact', 'status': status, 'unverifiedTranslationIds': sorted({e['translationId'] for e in raw['entries']} - {p['translationId'] for p in proofs}), 'evidence': proofs})
        if allowed:
            labels = {}
            for p in proofs:
                if p['status'] == 'played' and p.get('label', '').startswith('Люб.') and ' · ' in p.get('observedVoice', ''):
                    label = p['observedVoice'].split(' · ', 1)[1].strip()
                    assert label and len(label) <= 200 and '\ufffd' not in label
                    labels[p['translationId']] = label
            target = dict(raw)
            target['entries'] = [{**e, 'label': labels.get(e['translationId'], e['label'])} for e in raw['entries'] if e['translationId'] in allowed]
            selected.append(target)
    report = {'version': '0.5.1', 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'candidateCount': 73, 'exactMetadataCount': len(reports), 'selectedIds': [r['shikimoriId'] for r in selected], 'attemptedChecks': len(evidence), 'playbackChecks': proof_count, 'newAnime': len([r for r in selected if r['shikimoriId'] not in configured_ids]), 'translationOptions': sum(len({e['translationId'] for e in r['entries']}) for r in selected), 'episodeNumbers': sum(len({e['episodeNumber'] for e in r['entries']}) for r in selected), 'newRawVoiceLabels': sorted({e['label'] for r in selected for e in r['entries']} - baseline_labels), 'reasons': {s: sum(r['status'] == s for r in reports) for s in sorted({r['status'] for r in reports})}, 'candidates': reports, 'deployment': 'pending'}
    write(ROOT / 'docs/diagnostics/ANIMEGO_0.5.1_REVIEW.json', report)
    if args.apply:
        assert selected
        for r in selected: write(ROOT / f"public/data/video/animego/{r['shikimoriId']}.json", r)
        index = read(ROOT / 'src/data/animego-index.json'); index['ids'] = sorted(old_ids | {r['shikimoriId'] for r in selected}); index['checkedAt'] = report['checkedAt']; write(ROOT / 'src/data/animego-index.json', index)
    print(json.dumps({k: v for k, v in report.items() if k != 'candidates'}, ensure_ascii=True))

if __name__ == '__main__': main()
