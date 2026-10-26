"""Bounded server-only metadata probe using the owner's Actions Secret; no stream extraction."""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.cache/provider-review/kodik.json'
OUT.parent.mkdir(parents=True, exist_ok=True)
ids = json.loads((ROOT / 'docs/diagnostics/ANIMEPARSERS_COHORT_2026-10-27.json').read_text())['ids']
assert 1 <= len(ids) <= 40 and len(set(ids)) == len(ids) and ids[0] == 54744
token = os.environ.get('KODIK_API_TOKEN', '').strip()
report = {'provider': 'Kodik', 'encoding': 'POST application/x-www-form-urlencoded body per AnimeParsers api_kodik.py', 'rows': [], 'requests': 0}
if not token:
    report['stop'] = 'missing-owner-secret'
else:
    for shiki in ids:
        time.sleep(1.5)
        payload = urllib.parse.urlencode({'token': token, 'shikimori_id': shiki, 'limit': 100, 'with_material_data': 'true', 'with_seasons': 'true', 'with_episodes': 'true'}).encode()
        request = urllib.request.Request('https://kodik-api.com/search', data=payload, headers={'Accept': 'application/json', 'User-Agent': 'AniRezik-Approved-Metadata-Probe/0.5.0', 'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
        report['requests'] += 1
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise ValueError('oversized-response')
                raw = json.loads(body)
                if raw.get('error'):
                    report['stop'] = 'api-error-response'; break
            releases = []
            for item in raw.get('results', []):
                # Whitelist metadata only; never retain next_page URLs or arbitrary credential fields.
                row = {k: item.get(k) for k in ['id', 'shikimori_id', 'title', 'title_orig', 'year', 'type', 'blocked_countries', 'blocked_seasons']}
                row['translation'] = {k: item.get('translation', {}).get(k) for k in ['id', 'title', 'type']}
                row['anime_kind'] = item.get('material_data', {}).get('anime_kind')
                def embed(value):
                    value = 'https:' + value if isinstance(value, str) and value.startswith('//') else value
                    u = urllib.parse.urlparse(value or '')
                    if u.scheme == 'https' and u.hostname in ['kodikplayer.com', 'kodik.info'] and not u.username and not u.password and not u.query and not u.fragment:
                        return value
                    return None
                row['embedUrl'] = embed(item.get('link'))
                row['seasons'] = {str(n): {str(ep): embed(v if isinstance(v, str) else v.get('link')) for ep, v in season.get('episodes', {}).items()} for n, season in item.get('seasons', {}).items()}
                releases.append(row)
            report['rows'].append({'shikimoriId': shiki, 'http': 200, 'total': raw.get('total'), 'truncated': bool(raw.get('next_page')) or raw.get('total', 0) > len(raw.get('results', [])), 'releases': releases})
        except urllib.error.HTTPError as error:
            report['rows'].append({'shikimoriId': shiki, 'http': error.code})
            report['stop'] = 'http-' + str(error.code); break
        except Exception:
            report['stop'] = 'transport-or-schema-error'; break
encoded = json.dumps(report, ensure_ascii=False)
assert not token or token not in encoded
OUT.write_text(encoded + '\n', encoding='utf-8')
print(json.dumps({'requests': report['requests'], 'completedIds': len(report['rows']), 'stop': report.get('stop')}))
