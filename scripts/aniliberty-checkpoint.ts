import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { validateLibertyState } from './lib/aniliberty-sync.ts';
const branch = 'codex/aniliberty-sync-state';
const file = '.cache/aniliberty-index/progress-v2.json';
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
    validateLibertyState(JSON.parse(content));
    await mkdir('.cache/aniliberty-index', { recursive: true });
    await writeFile(file, content + '\n');
    console.log('Durable AniLiberty checkpoint restored');
  } else console.log('No checkpoint yet; begin a new scan');
} else if (process.argv[2] === 'save') {
  const content = await readFile(file, 'utf8');
  validateLibertyState(JSON.parse(content));
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
