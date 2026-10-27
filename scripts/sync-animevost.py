"""Bounded, resumable metadata sync. Does not fetch or persist media URLs.

Candidates never contain media URLs. --publish-reviewed restricts to observed
playback; --publish-exact permits lazy resolution after an explicit pilot gate.
"""
import argparse
import ast
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/animevost-sync'


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    compact = path.name == 'animevost-index.json'
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=None if compact else 2,
                              separators=(',', ':') if compact else None) + '\n', encoding='utf8')
    tmp.replace(path)


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold().replace('ё', 'е') if c.isalnum())


def episode_numbers(row):
    try:
        value = ast.literal_eval(row.get('series') or '{}')
    except (ValueError, SyntaxError):
        return []
    if not isinstance(value, dict):
        return []
    numbers = [int(m[1]) for key in value if (m := re.fullmatch(r'(\d+) серия', key)) and int(m[1]) > 0]
    if row.get('type') == 'полнометражный фильм' and list(value) == ['Фильм']:
        return [1]
    return sorted(set(numbers))


def match_catalog(rows, catalog):
    # Exact normalized aliases + exact year/format. Numbers are retained so
    # seasons/parts/remakes are not collapsed. Ambiguity always requires review.
    aliases = {}
    for anime in catalog:
        if not anime.get('shikimoriId') or not anime.get('year'):
            continue
        names = [anime.get(k) for k in ['title', 'originalTitle', 'englishTitle']]
        names += anime.get('aliases') or []
        for name in names:
            if isinstance(name, str) and name.strip():
                key = (normalize(name), str(anime['year']), anime['kind'])
                aliases.setdefault(key, set()).add(anime['shikimoriId'])
    candidates, rejected = {}, []
    for row in rows:
        kind = {'ТВ': 'tv', 'полнометражный фильм': 'movie', 'OVA': 'ova', 'ONA': 'ona'}.get(row.get('type'))
        title = re.sub(r'\s*\[[^]]*\]\s*$', '', row.get('title', ''))
        ids = set()
        for name in title.split(' / '):
            ids.update(aliases.get((normalize(name), str(row.get('year')), kind), set()))
        numbers = episode_numbers(row)
        if len(ids) != 1 or not numbers:
            rejected.append({'releaseId': row['id'], 'title': row.get('title'),
                             'reason': 'ambiguous' if len(ids) > 1 else 'no-exact-match-or-episodes'})
            continue
        id = str(next(iter(ids)))
        candidates.setdefault(id, []).append({'releaseId': row['id'], 'episodeNumbers': numbers,
                                               'title': row.get('title'), 'year': row.get('year'), 'kind': kind})
    accepted = {id: values[0] for id, values in candidates.items() if len(values) == 1}
    rejected += [{'shikimoriId': id, 'reason': 'multiple-provider-releases'}
                 for id, values in candidates.items() if len(values) != 1]
    return accepted, rejected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--max-pages', type=int, default=5)
    parser.add_argument('--delay', type=float, default=2)
    parser.add_argument('--publish-reviewed', action='store_true')
    parser.add_argument('--publish-exact', action='store_true')
    args = parser.parse_args()
    if args.max_pages < 0 or args.delay < 2:
        parser.error('Nonnegative budget and delay >= 2 seconds required')
    CACHE.mkdir(parents=True, exist_ok=True)
    checkpoint = CACHE / 'checkpoint.json'
    state = json.loads(checkpoint.read_text(encoding='utf8')) if checkpoint.exists() else {
        'nextPage': 1, 'rows': {}, 'complete': False, 'error': None}
    # An access error needs explicit operator investigation, not an automatic loop.
    if state.get('error') and args.max_pages:
        raise SystemExit('Saved source error; no requests sent. Resolve with supplier before resuming.')
    for _ in range(args.max_pages):
        if state['complete']:
            break
        page = state['nextPage']
        request = urllib.request.Request(f'https://api.animevost.org/v1/last?page={page}&quantity=40',
            headers={'User-Agent': 'AniRezik/0.5.1 (authorized metadata sync; contact via animevost permission)'})
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                data = json.loads(response.read(8_000_000))
            if data.get('state', {}).get('status') != 'ok' or not isinstance(data.get('data'), list):
                raise ValueError('Unexpected API response')
            rows = data['data']
            # Only public matching metadata, no descriptions/posters/media URLs.
            for row in rows:
                if not isinstance(row.get('id'), int) or row['id'] < 1:
                    raise ValueError('Invalid release ID')
                state['rows'][str(row['id'])] = {key: row.get(key) for key in ['id', 'title', 'year', 'type', 'series']}
            state['reportedTotal'] = data['state'].get('count')
            state['nextPage'] += 1
            # The supplier caps quantity at 40, even when 100 is requested.
            # Do not mistake a capped first page for a completed catalog.
            state['complete'] = len(rows) < 40 and len(state['rows']) >= int(state['reportedTotal'] or 0)
            if len(rows) < 40 and not state['complete']:
                raise ValueError('Short page before reported total; preserve checkpoint for investigation')
            atomic(checkpoint, state)
            print(f'page={page} uniqueReleases={len(state["rows"])} complete={state["complete"]}', flush=True)
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as error:
            state['error'] = {'type': type(error).__name__, 'http': getattr(error, 'code', None), 'page': page}
            atomic(checkpoint, state)
            raise SystemExit('Source request failed; checkpoint saved; no further requests.')
        time.sleep(args.delay)
    catalog = json.loads((ROOT / 'src/data/catalog.json').read_text(encoding='utf8'))['anime']
    candidates, rejected = match_catalog(state['rows'].values(), catalog)
    atomic(CACHE / 'candidates.json', {'complete': state['complete'], 'mappings': candidates, 'rejected': rejected})
    if args.publish_reviewed:
        evidence = json.loads((ROOT / 'src/data/animevost-reviewed.json').read_text(encoding='utf8'))
        mappings = {}
        for id, review in evidence['mappings'].items():
            candidate = candidates.get(id)
            if not candidate or candidate['releaseId'] != review['releaseId'] or not review.get('playbackVerified'):
                raise SystemExit(f'Review mismatch: {id}; existing index preserved')
            mappings[id] = {key: candidate[key] for key in ['releaseId', 'episodeNumbers', 'kind']}
        atomic(ROOT / 'src/data/animevost-index.json', {'version': 1, 'mappings': mappings})
    if args.publish_exact:
        rights = json.loads((ROOT / 'src/data/animevost-rights.json').read_text(encoding='utf8'))
        pilot = json.loads((ROOT / 'src/data/animevost-reviewed.json').read_text(encoding='utf8'))
        if not rights.get('verified') or not rights.get('playbackAllowed') or not pilot.get('browserGatePassed'):
            raise SystemExit('Direct rights and successful cross-browser pilot required; index preserved')
        mappings = {id: {key: row[key] for key in ['releaseId', 'episodeNumbers', 'kind']}
                    for id, row in candidates.items()}
        # A partial upstream snapshot must never remove previously approved data.
        old = json.loads((ROOT / 'src/data/animevost-index.json').read_text(encoding='utf8'))['mappings']
        if not state['complete']:
            mappings = {**old, **mappings}
        atomic(ROOT / 'src/data/animevost-index.json', {'version': 1, 'mappings': mappings})
    print(f'exactCandidates={len(candidates)} reviewRequired={len(rejected)}', flush=True)


if __name__ == '__main__':
    main()
