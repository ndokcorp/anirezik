import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const load = async (name: string) => JSON.parse(await readFile(`src/data/${name}.json`, 'utf8'));
const evidence = await load('auto-sync-evidence'),
  report = await load('auto-sync-report');
const known = new Set((await load('catalog')).anime.map((a: any) => a.shikimoriId));
for (const [provider, file] of [
  ['animevost', 'animevost-index'],
  ['aniliberty', 'aniliberty-index'],
]) {
  const current = await load(file),
    old = JSON.parse(
      execFileSync('git', ['show', `HEAD:src/data/${file}.json`], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  for (const [id, m] of Object.entries(old.mappings) as [string, any][]) {
    if (
      !current.mappings[id] &&
      provider === 'aniliberty' &&
      report.withdrawals?.some(
        (w: any) =>
          w.id === Number(id) &&
          w.releaseId === m.releaseId &&
          ['copyright', 'confirmed-404'].includes(w.reason) &&
          Number.isFinite(Date.parse(w.checkedAt)),
      )
    )
      continue;
    if (!current.mappings[id] || current.mappings[id].releaseId !== m.releaseId)
      throw Error('Existing mapping removed or replaced without confirmed withdrawal');
  }
  for (const [id, m] of Object.entries(current.mappings) as [string, any][]) {
    if (!known.has(Number(id)) || !Number.isSafeInteger(m.releaseId) || m.releaseId < 1)
      throw Error('Invalid identity');
    if (JSON.stringify(old.mappings[id]) === JSON.stringify(m)) continue;
    const proof = evidence.records?.[`${provider}:${m.releaseId}`];
    if (
      !proof?.passed ||
      proof.id !== Number(id) ||
      !report.publishedCandidates.some(
        (c: any) =>
          c.provider === provider &&
          c.id === Number(id) &&
          c.releaseId === m.releaseId &&
          c.fingerprint === proof.fingerprint,
      ) ||
      !proof.episodes?.length ||
      proof.episodes.some(
        (o: any) => !(o.time > 3 && o.width > 0 && o.height > 0 && o.duration > 0),
      )
    )
      throw Error('Missing actual decoded video evidence');
  }
  if (/https?:|playbackUrl|hls_\d|token/i.test(JSON.stringify(current)))
    throw Error('Sensitive or transient data in index');
}
const [vost, liberty] = await Promise.all([load('animevost-rights'), load('video-rights')]);
if (
  !vost.verified ||
  !vost.playbackAllowed ||
  !liberty.playbackAllowed ||
  liberty.status !== 'permission-granted'
)
  throw Error('Provider permission missing');
console.log(
  'Global sync: no removals, exact numeric identities, decoded-video gate, existing rights',
);
