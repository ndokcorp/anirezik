/** Existing supplier checkpoints -> identity plan -> bounded real Player gate -> candidate artifact.
 * No video URL, credential or undocumented endpoint is persisted here. */
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { planIdentities, chooseQueue, type SyncCandidate } from './lib/global-auto-sync.ts';
import { randomUUID } from 'node:crypto';
const root = '.cache/global-auto-sync';
const load = async (path: string, fallback?: any) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
};
const save = async (path: string, value: any) => {
  await writeFile(
    path + '.tmp',
    JSON.stringify(value, null, /(?:-index|-needs-review)\.json$/.test(path) ? undefined : 2) +
      '\n',
  );
  await rename(path + '.tmp', path);
};
await mkdir(root + '/candidate', { recursive: true });
await mkdir(root + '/baseline', { recursive: true });
const files = [
  'animevost-index',
  'aniliberty-index',
  'aniliberty-needs-review',
  'aniliberty-sync-report',
  'auto-sync-evidence',
];
const mode = process.argv[2];
if (mode === 'plan') {
  const runToken = randomUUID();
  await writeFile(
    `${root}/worker.lock`,
    JSON.stringify({ runToken, pid: process.pid, startedAt: new Date().toISOString() }),
    { flag: 'wx' },
  );
  const policy = await load('src/data/auto-sync-policy.json');
  const max = Number(process.env.AUTO_SYNC_MAX_CANDIDATES || policy.maxCandidatesPerRun || 5);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw Error('Candidate budget must be 1..20');
  const catalog = (await load('src/data/catalog.json')).anime;
  const evidence = await load('src/data/auto-sync-evidence.json', { version: 1, records: {} });
  const cached = await load(`${root}/candidate/auto-sync-evidence.json`, { records: {} });
  for (const [key, row] of Object.entries(cached.records) as [string, any][]) {
    if (
      !evidence.records[key] ||
      Date.parse(row.checkedAt) > Date.parse(evidence.records[key].checkedAt)
    )
      evidence.records[key] = row;
  }
  evidence.providerBlocks ||= {};
  for (const [provider, block] of Object.entries(cached.providerBlocks || {}) as [string, any][]) {
    const old = evidence.providerBlocks[provider];
    if (!old || Date.parse(block.clearedAt || block.at) > Date.parse(old.clearedAt || old.at))
      evidence.providerBlocks[provider] = block;
  }
  for (const name of files)
    await save(
      `${root}/baseline/${name}.json`,
      name === 'auto-sync-evidence' ? evidence : await load(`src/data/${name}.json`),
    );
  const vost = await load('.cache/animevost-sync/checkpoint.json', { rows: {} });
  const liberty = await load('.cache/aniliberty-index/progress-v2.json', {
    catalog: {},
    evidence: {},
  });
  const libertyRows = Object.values(liberty.catalog).map((r: any) => ({
    ...r,
    episodeNumbers: liberty.evidence[r.id]?.episodeNumbers || [],
  }));
  const plans = [
    planIdentities('animevost', Object.values(vost.rows), catalog),
    planIdentities('aniliberty', libertyRows, catalog),
  ];
  const candidates = plans.flatMap((p) => p.candidates),
    baselineVost = await load('src/data/animevost-index.json'),
    baselineLib = await load('src/data/aniliberty-index.json');
  const pending = candidates.filter((c) => {
    const mappings = (c.provider === 'animevost' ? baselineVost : baselineLib).mappings;
    if (
      Object.entries(mappings).some(
        ([id, m]: [string, any]) => Number(id) !== c.id && m.releaseId === c.releaseId,
      )
    )
      return false;
    const old = mappings[c.id];
    return (
      !old ||
      (old.releaseId === c.releaseId &&
        c.provider === 'animevost' &&
        c.episodeNumbers.some((n) => !old.episodeNumbers.includes(n)))
    );
  });
  const conflicts = candidates
    .filter((c) => {
      const m = (c.provider === 'animevost' ? baselineVost : baselineLib).mappings[c.id];
      return m && m.releaseId !== c.releaseId;
    })
    .map((c) => ({
      provider: c.provider,
      id: c.id,
      releaseId: c.releaseId,
      status: 'NEEDS REVIEW',
      reason: 'existing-mapping-release-conflict',
    }));
  // Existing different-release mappings are never replaced automatically.
  const eligible = chooseQueue(
    pending,
    evidence.records,
    pending.length,
    Date.now(),
    (policy.failedVideoRetryHours || 24) * 3600000,
  );
  const priority = eligible.filter((c) => policy.priorityShikimoriIds.includes(c.id));
  const remaining = eligible.filter((c) => !priority.includes(c));
  const fair = remaining
    .filter((c) => c.provider === 'aniliberty')
    .flatMap((c, i) => [c, ...remaining.filter((x) => x.provider === 'animevost').slice(i, i + 1)]);
  const enabledProviders = (process.env.AUTO_SYNC_PROVIDERS || 'animevost,aniliberty')
    .split(',')
    .filter((provider) => {
      const block = evidence.providerBlocks[provider];
      return !block || (block.clearedAt && Date.parse(block.clearedAt) > Date.parse(block.at));
    });
  const selectedAllowed = [...new Set([...priority, ...fair, ...remaining])]
    .filter((c) => enabledProviders.includes(c.provider))
    .slice(0, max);
  const withdrawals =
    liberty.phase === 'complete'
      ? Object.entries(baselineLib.mappings).flatMap(([id, m]: [string, any]) => {
          const e = liberty.evidence[m.releaseId];
          const confirmed = liberty.withdrawals?.find((w: any) => w.releaseId === m.releaseId);
          return confirmed ||
            (e &&
              ((e.status === 'withdrawn' && e.reason === 'confirmed-404') ||
                e.reason === 'copyright'))
            ? [
                {
                  provider: 'aniliberty',
                  id: Number(id),
                  releaseId: m.releaseId,
                  reason: confirmed?.reason || e.reason,
                  checkedAt: confirmed?.checkedAt || e.checkedAt,
                },
              ]
            : [];
        })
      : [];
  await save(`${root}/video-results.json`, { records: [] });
  await save(`${root}/plan.json`, {
    version: 1,
    runToken,
    checkedAt: new Date().toISOString(),
    counts: {
      animevostRows: Object.keys(vost.rows).length,
      libertyRows: libertyRows.length,
      identityCandidates: candidates.length,
      pending: pending.length,
      selected: selectedAllowed.length,
      review: plans.flatMap((p) => p.review).length + conflicts.length,
    },
    basis: candidates.reduce((a: any, c) => {
      a[c.basis] = (a[c.basis] || 0) + 1;
      return a;
    }, {}),
    selected: selectedAllowed,
    enabledProviders,
    withdrawals,
    review: [...plans.flatMap((p) => p.review), ...conflicts],
  });
  // Temporary working-copy indexes for the dev-only browser gate. Not publication.
  for (const c of selectedAllowed) {
    if (c.provider === 'animevost')
      baselineVost.mappings[c.id] = {
        releaseId: c.releaseId,
        episodeNumbers: c.episodeNumbers,
        kind: c.kind,
      };
    else {
      baselineLib.mappings[c.id] = {
        releaseId: c.releaseId,
        basis:
          c.basis === 'mal.id'
            ? 'mal.id'
            : c.basis === 'shikimori.id'
              ? 'shikimori.id'
              : 'metadata',
        checkedAt: new Date().toISOString(),
      };
      baselineLib.excludedIds = baselineLib.excludedIds.filter((id: number) => id !== c.id);
    }
  }
  await save('src/data/animevost-index.json', baselineVost);
  await save('src/data/aniliberty-index.json', baselineLib);
  console.log(
    JSON.stringify({
      selected: selectedAllowed.map((c) => ({
        provider: c.provider,
        id: c.id,
        releaseId: c.releaseId,
        basis: c.basis,
      })),
      pending: pending.length,
    }),
  );
} else if (mode === 'finalize') {
  const plan = await load(`${root}/plan.json`),
    results = await load(`${root}/video-results.json`, { records: [] });
  const owner = await load(`${root}/worker.lock`);
  if (!owner.runToken || owner.runToken !== plan.runToken)
    throw Error('Stale or foreign sync manifest; no index changes made');
  const data: Record<string, any> = {};
  for (const name of files) data[name] = await load(`${root}/baseline/${name}.json`);
  const passed: SyncCandidate[] = [];
  for (const c of plan.selected as SyncCandidate[]) {
    const result = results.records.find(
      (r: any) => r.provider === c.provider && r.id === c.id && r.releaseId === c.releaseId,
    );
    if (result?.reason === 'provider-access-restriction') {
      data['auto-sync-evidence'].providerBlocks ||= {};
      data['auto-sync-evidence'].providerBlocks[c.provider] = {
        at: new Date().toISOString(),
        reason: result.reason,
      };
    }
    if (result)
      data['auto-sync-evidence'].records[`${c.provider}:${c.releaseId}`] = {
        fingerprint: c.fingerprint,
        checkedAt: new Date().toISOString(),
        passed: result.passed,
        status: result.passed ? 'AUTO-APPROVED' : 'NEEDS REVIEW',
        id: c.id,
        releaseId: c.releaseId,
        episodes: result.episodes || [],
        reason: result.reason || null,
      };
    if (
      !result?.passed ||
      !result.episodes?.length ||
      result.episodes.some((o: any) => !(o.time > 3 && o.width > 0 && o.duration > 0))
    )
      continue;
    passed.push(c);
    if (c.provider === 'animevost')
      data['animevost-index'].mappings[c.id] = {
        releaseId: c.releaseId,
        episodeNumbers: c.episodeNumbers,
        kind: c.kind,
      };
    else {
      if (!data['aniliberty-index'].mappings[c.id]) {
        data['aniliberty-sync-report'].newAnime =
          (data['aniliberty-sync-report'].newAnime || 0) + 1;
        data['aniliberty-sync-report'].mappedEpisodes =
          (data['aniliberty-sync-report'].mappedEpisodes || 0) + c.episodeNumbers.length;
      }
      data['aniliberty-index'].mappings[c.id] = {
        releaseId: c.releaseId,
        basis:
          c.basis === 'mal.id'
            ? 'mal.id'
            : c.basis === 'shikimori.id'
              ? 'shikimori.id'
              : 'metadata',
        checkedAt: new Date().toISOString(),
      };
      data['aniliberty-index'].excludedIds = data['aniliberty-index'].excludedIds.filter(
        (id: number) => id !== c.id,
      );
      data['aniliberty-needs-review'] = data['aniliberty-needs-review'].filter(
        (r: any) => r.releaseId !== c.releaseId,
      );
    }
  }
  for (const w of plan.withdrawals || []) {
    if (data['aniliberty-index'].mappings[w.id]?.releaseId !== w.releaseId)
      throw Error('Withdrawal identity changed');
    delete data['aniliberty-index'].mappings[w.id];
    data['aniliberty-index'].excludedIds = [
      ...new Set([...data['aniliberty-index'].excludedIds, w.id]),
    ].sort((a: any, b: any) => a - b);
  }
  data['aniliberty-sync-report'].matchedAnime = Object.keys(
    data['aniliberty-index'].mappings,
  ).length;
  data['aniliberty-sync-report'].needsReview = data['aniliberty-needs-review'].length;
  for (const name of files) {
    await save(`${root}/candidate/${name}.json`, data[name]);
    await save(`src/data/${name}.json`, await load(`${root}/baseline/${name}.json`));
  }
  const summary = {
    version: 1,
    checkedAt: new Date().toISOString(),
    counts: plan.counts,
    basis: plan.basis,
    publishedCandidates: passed,
    withdrawals: plan.withdrawals || [],
    videoResults: results.records,
    scope: 'Browser sample only; not all episodes or regions',
  };
  await save(`${root}/candidate/auto-sync-report.json`, summary);
  await save(`${root}/report.json`, summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Source sync\n\nIdentity candidates: ${plan.counts.identityCandidates}. Actual Player gate: ${passed.length} approved of ${results.records.length} probes. Pending: ${plan.counts.pending - passed.length}. Failed candidates are quarantined; no video URL is persisted.\n`,
      { flag: 'a' },
    );
  if (process.env.GITHUB_OUTPUT)
    await writeFile(
      process.env.GITHUB_OUTPUT,
      `changed=${passed.length > 0 || !!plan.withdrawals?.length}\n`,
      { flag: 'a' },
    );
  console.log(
    JSON.stringify({
      approved: passed.length,
      videoResults: results.records.length,
      pending: plan.counts.pending - passed.length,
    }),
  );
  await unlink(`${root}/worker.lock`).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e;
  });
} else throw Error('Use plan or finalize');
