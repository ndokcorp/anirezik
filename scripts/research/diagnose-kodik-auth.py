"""One owner-authorized request; retain only an enum, never server text or credentials."""
import json, os, re, urllib.error, urllib.parse, urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

token = os.environ.get('KODIK_API_TOKEN', '').strip()
result = {'requests': 0, 'authorization': 'POST form token, owner Actions Secret', 'shikimoriId': 54744}
if not token:
    result['reason'] = 'missing-owner-secret'
else:
    request = urllib.request.Request('https://kodik-api.com/search', data=urllib.parse.urlencode({'token': token, 'shikimori_id': 54744, 'limit': 1}).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'AniRezik-Owner-Auth-Diagnostic/0.5.1'}, method='POST')
    result['requests'] = 1
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            result['http'] = response.status
            response.read(65536)  # Results/media are deliberately not retained.
        result['reason'] = 'authorized-http-response'
    except urllib.error.HTTPError as error:
        result['http'] = error.code
        body = error.read(65536).decode('utf-8', errors='replace').replace(token, '[redacted]').lower()
        result['reason'] = 'unauthorized-unspecified' if error.code == 401 else 'http-refusal'
        for pattern, code in [(r'expired.{0,24}token|token.{0,24}expired', 'expired-token'), (r'invalid.{0,24}token|token.{0,24}invalid|wrong.{0,24}token', 'invalid-token'), (r'ip.{0,24}(?:blocked|denied|allowlist|whitelist)', 'ip-policy'), (r'missing.{0,24}token|token.{0,24}required', 'missing-token')]:
            if re.search(pattern, body): result['reason'] = code; break
    except Exception:
        result['reason'] = 'transport-error'
path = Path('.cache/provider-review/kodik-auth.json'); path.parent.mkdir(parents=True, exist_ok=True)
encoded = json.dumps(result); assert not token or token not in encoded
path.write_text(encoded + '\n', encoding='utf-8'); print(encoded)
