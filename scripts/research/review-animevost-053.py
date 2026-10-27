"""Offline classification of the saved 866 deferred records; never sends HTTP."""
import importlib.util
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('animevost_sync', ROOT / 'scripts/sync-animevost.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
state = json.loads((ROOT / '.cache/animevost-sync/checkpoint.json').read_text(encoding='utf8'))
baseline_path = ROOT / '.cache/animevost-053/baseline-deferred.json'
if not baseline_path.exists():
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    baseline_path.write_text((ROOT / '.cache/animevost-sync/candidates.json').read_text(encoding='utf8'), encoding='utf8')
baseline = json.loads(baseline_path.read_text(encoding='utf8'))
reviewed = json.loads((ROOT / 'src/data/animevost-reviewed.json').read_text(encoding='utf8'))['mappings']
published = json.loads((ROOT / 'src/data/animevost-index.json').read_text(encoding='utf8'))['mappings']
catalog = json.loads((ROOT / 'src/data/catalog.json').read_text(encoding='utf8'))['anime']
by_id = {str(a.get('shikimoriId')): a for a in catalog}
matches, revised_rejected = sync.match_catalog(state['rows'].values(), catalog)
count_conflicts = {row['releaseId'] for row in revised_rejected if row['reason'] == 'singleton-count-conflict'}
singleton = {row['releaseId']: id for id, row in matches.items() if row.get('singleEntryLabel')}
aliases = {}
for a in catalog:
    for title in [a.get('title'), a.get('originalTitle'), a.get('englishTitle'), *(a.get('aliases') or [])]:
        if isinstance(title, str) and title.strip():
            aliases.setdefault(sync.normalize(title), []).append(a)
rows = []
for rejected in baseline['rejected']:
    row = state['rows'].get(str(rejected.get('releaseId')), {})
    result = {**rejected, 'playbackVerified': False, 'enabledByThisAudit': False}
    reason = rejected['reason']
    if reason == 'episode-range-conflict':
        a = by_id[str(rejected['shikimoriId'])]
        result.update(category='range-conflict', catalogTitle=a['title'], status=a.get('status'),
                      rangeClass='large-overrun' if rejected['providerMaxEpisode'] >= 2 * rejected['catalogEpisodes'] else 'modest-overrun',
                      resolution='Keep disabled: no authoritative season boundaries / extra classification')
    elif reason == 'ambiguous':
        result['category'] = 'ambiguous-identity'
    elif row.get('id') in singleton:
        result.update(category='explicit-singleton-candidate', shikimoriId=singleton[row['id']],
                      resolution='Exact name/year/format; needs real playlist and video verification')
    elif row.get('id') in count_conflicts:
        result.update(category='singleton-count-conflict', resolution='One named file but canonical title has multiple episodes; keep disabled')
    else:
        kind = {'ТВ': 'tv', 'полнометражный фильм': 'movie', 'OVA': 'ova', 'ONA': 'ona'}.get(row.get('type'))
        title = sync.re.sub(r'\s*\[[^]]*\]\s*$', '', row.get('title', ''))
        hits = [a for name in title.split(' / ') for a in aliases.get(sync.normalize(name), [])]
        same_year = [a for a in hits if str(a.get('year')) == str(row.get('year'))]
        exact = [a for a in same_year if a.get('kind') == kind]
        result['category'] = ('unrecognized-episode-label-or-empty-metadata' if exact else
                              'format-conflict' if same_year else 'year-conflict' if hits else 'no-exact-title')
    id = str(result.get('shikimoriId', ''))
    if id in reviewed and reviewed[id].get('playbackVerified') and reviewed[id]['releaseId'] == row.get('id'):
        result['playbackVerified'] = True
        result['enabledByThisAudit'] = published.get(id, {}).get('releaseId') == row.get('id')
        result['resolution'] = 'Exact standalone title/year/format; actual video decoded and time advanced in sample'
    rows.append(result)
assert len(rows) == 866
report = {'date': '2026-10-28', 'networkRequests': 0, 'baselineDeferred': len(rows),
          'categories': dict(Counter(row['category'] for row in rows)),
          'rangeClasses': dict(Counter(row['rangeClass'] for row in rows if 'rangeClass' in row)),
          'enabledAfterVideoCheck': sum(row['enabledByThisAudit'] for row in rows),
          'remainingDeferred': sum(not row['enabledByThisAudit'] for row in rows),
          'records': rows}
path = ROOT / 'docs/diagnostics/ANIMEVOST_DEFERRED_0.5.3.json'
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps({k: report[k] for k in ['baselineDeferred', 'categories', 'rangeClasses', 'networkRequests']}))
