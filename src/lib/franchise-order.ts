import type { Anime } from '../types/anime';
// Prequel/sequel edges take precedence over release dates; dates order independent branches.
export function orderFranchise(items: Anime[]) {
  const byId = new Map(items.map((a) => [a.shikimoriId, a]));
  const edges = new Map(items.map((a) => [a.shikimoriId, new Set<number>()]));
  const incoming = new Map(items.map((a) => [a.shikimoriId, 0]));
  for (const a of items)
    for (const r of a.related) {
      if (!byId.has(r.shikimoriId) || r.shikimoriId === a.shikimoriId) continue;
      let from: number, to: number;
      if (r.relationKind === 'prequel') {
        from = r.shikimoriId;
        to = a.shikimoriId;
      } else if (r.relationKind === 'sequel') {
        from = a.shikimoriId;
        to = r.shikimoriId;
      } else continue;
      if (!edges.get(from)!.has(to)) {
        edges.get(from)!.add(to);
        incoming.set(to, incoming.get(to)! + 1);
      }
    }
  const dateOrder = (x: Anime, y: Anime) =>
    (x.airedOn || '9999').localeCompare(y.airedOn || '9999') || x.shikimoriId - y.shikimoriId;
  const remaining = new Set(byId.keys()),
    result: Anime[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => incoming.get(id) === 0)
      .map((id) => byId.get(id)!)
      .sort(dateOrder);
    // Conflicting source relations cannot establish a canonical order; break cycles by known dates.
    const next = ready[0] || [...remaining].map((id) => byId.get(id)!).sort(dateOrder)[0];
    remaining.delete(next.shikimoriId);
    result.push(next);
    for (const target of edges.get(next.shikimoriId)!)
      incoming.set(target, incoming.get(target)! - 1);
  }
  return result;
}
