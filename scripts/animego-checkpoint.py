"""Persist sanitized SQLite checkpoint on its own Git branch, never on main."""
import gzip,json,os,sqlite3,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; CACHE=ROOT/'.cache/animego-full'; CACHE.mkdir(parents=True,exist_ok=True)
BRANCH='codex/animego-sync-state'
def git(*args,input=None,check=True):
 p=subprocess.run(['git',*args],input=input,capture_output=True,check=check,cwd=ROOT)
 return p.stdout
parent=''
try:
 git('fetch','--no-tags','origin',f'refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}')
 parent=git('rev-parse',f'refs/remotes/origin/{BRANCH}').decode().strip()
except subprocess.CalledProcessError:
 if git('ls-remote','--heads','origin',BRANCH).strip():raise RuntimeError('Cannot fetch existing checkpoint')
if sys.argv[1]=='restore':
 if parent:
  data=git('show',parent+':state.sqlite.gz')
  with gzip.GzipFile(fileobj=__import__('io').BytesIO(data)) as f:
   raw=f.read(200_000_001)
  if len(raw)>200_000_000 or not raw.startswith(b'SQLite format 3\0'):raise ValueError('Invalid checkpoint')
  (CACHE/'state.sqlite').write_bytes(raw)
  db=sqlite3.connect(CACHE/'state.sqlite');assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';db.close()
  print('Restored AnimeGO catalog checkpoint')
 else: print('New catalog scan')
elif sys.argv[1]=='save':
 # SQLite backup produces a coherent snapshot even after a cancelled worker.
 source=sqlite3.connect(CACHE/'state.sqlite'); target=sqlite3.connect(CACHE/'backup.sqlite');source.backup(target);target.close();source.close()
 zipped=gzip.compress((CACHE/'backup.sqlite').read_bytes(),mtime=0)
 if len(zipped)>45_000_000:raise ValueError('Checkpoint too large: split state before continuing')
 blob=git('hash-object','-w','--stdin',input=zipped).decode().strip()
 entries=f'100644 blob {blob}\tstate.sqlite.gz\n'
 report=CACHE/'report.json'
 if report.exists():
  reportblob=git('hash-object','-w','--stdin',input=report.read_bytes()).decode().strip();entries=f'100644 blob {reportblob}\treport.json\n'+entries
 tree=git('mktree',input=entries.encode()).decode().strip()
 if parent and tree==git('rev-parse',parent+'^{tree}').decode().strip():print('Checkpoint unchanged');sys.exit(0)
 args=['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit-tree',tree]
 if parent:args+=['-p',parent]
 commit=git(*args,'-m','Save sanitized AnimeGO catalog cursor and observed iframe metadata').decode().strip()
 git('push','origin',commit+':refs/heads/'+BRANCH);print('Saved durable AnimeGO checkpoint')
else:raise ValueError('Use restore/save')
