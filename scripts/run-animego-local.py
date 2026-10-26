"""One-shot public-metadata collector. Publishing remains with the monitored Pages job."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/animego-full'
CACHE.mkdir(parents=True, exist_ok=True)

def status(state, **details):
    (CACHE / 'worker-status.json').write_text(json.dumps({'status': state, 'pid': os.getpid(), **details}, ensure_ascii=False), encoding='utf-8')

status('running')
try:
    subprocess.run([sys.executable, 'scripts/animego-checkpoint.py', 'restore'], cwd=ROOT, check=True)
    while True:
        result = subprocess.run([sys.executable, '-u', 'scripts/sync-animego-catalog.py', '--max-requests=500'], cwd=ROOT)
        subprocess.run([sys.executable, 'scripts/animego-checkpoint.py', 'save'], cwd=ROOT, check=True)
        report = json.loads((CACHE / 'report.json').read_text(encoding='utf-8'))
        if result.returncode or report.get('error'):
            raise RuntimeError('Collector stopped: ' + str(report.get('error')))
        if report['complete']:
            status('ready-for-publication', pagesProcessed=report['pagesProcessed'], readyAnime=report['readyAnime'])
            print('Full candidate ready. Monitoring task must validate/build/publish it.', flush=True)
            break
        status('running', pagesProcessed=report['pagesProcessed'], readyAnime=report['readyAnime'])
        time.sleep(2)
except Exception as error:
    status('stopped-error', error=str(error)[:250])
    raise
