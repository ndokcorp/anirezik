import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { validateLibertyState } from './lib/aniliberty-sync.ts';
const vost = process.argv[3] === 'animevost';
if (process.argv[3] && !vost) throw Error('Unknown checkpoint provider');
const branch = vost ? 'codex/animevost-sync-state' : 'codex/aniliberty-sync-state';
const file = vost
  ? '.cache/animevost-sync/checkpoint.json'
  : '.cache/aniliberty-index/progress-v2.json';
const validate = (value: unknown) => {
  if (!vost) {
    validateLibertyState(value);
    return;
  }
  const s = value as { rows: Record<string, { id: number }>; nextPage: number };
  if (!s?.rows || !Number.isSafeInteger(s.nextPage) || s.nextPage < 1)
    throw Error('Invalid AnimeVost checkpoint');
  for (const [id, row] of Object.entries(s.rows))
    if (
      String(row.id) !== id ||
      Object.keys(row).some((k) => !['id', 'title', 'year', 'type', 'series', 'url'].includes(k))
    )
      throw Error('Unsanitized AnimeVost checkpoint');
  if (/hls_\d|playbackUrl|api_token|password/i.test(JSON.stringify(s)))
    throw Error('Secret or media field in checkpoint');
};
const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    throw Error(`Checkpoint git ${args[0]} failed`);
  }
};
let parent = '';
try {
  git('fetch', '--no-tags', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`);
  parent = git('rev-parse', `refs/remotes/origin/${branch}`);
} catch {
  if (git('ls-remote', '--heads', 'origin', branch)) throw Error('Cannot fetch durable checkpoint');
}
if (process.argv[2] === 'restore') {
  if (parent) {
    const content = git('show', `${parent}:state.json`);
    validate(JSON.parse(content));
    await mkdir(vost ? '.cache/animevost-sync' : '.cache/aniliberty-index', { recursive: true });
    await writeFile(file, content + '\n');
    console.log('Durable AniLiberty checkpoint restored');
  } else console.log('No checkpoint yet; begin a new scan');
} else if (process.argv[2] === 'save') {
  const content = await readFile(file, 'utf8');
  validate(JSON.parse(content));
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    input: content,
    encoding: 'utf8',
  }).trim();
  const tree = execFileSync('git', ['mktree'], {
    input: `100644 blob ${blob}\tstate.json\n`,
    encoding: 'utf8',
  }).trim();
  if (parent && tree === git('rev-parse', `${parent}^{tree}`)) {
    console.log('Checkpoint unchanged');
    process.exit(0);
  }
  const commit = execFileSync(
    'git',
    [
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit-tree',
      tree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      'Save sanitized AniLiberty sync progress',
    ],
    { encoding: 'utf8' },
  ).trim();
  git('push', 'origin', `${commit}:refs/heads/${branch}`);
  console.log('Durable checkpoint saved (metadata and counts only)');
} else throw Error('Use restore or save');
