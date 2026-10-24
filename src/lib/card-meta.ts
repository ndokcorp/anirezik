export function ageLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    G: '6+',
    PG: '12+',
    'PG-13': '16+',
    'R-17': '18+',
    'R+': '18+',
    Rx: '18+',
  };
  return value ? (labels[value] ?? null) : null;
}
export function episodeLabel(type: string, episodes: number | null | undefined) {
  if (type === 'Фильм') return 'Фильм';
  return typeof episodes === 'number' && Number.isInteger(episodes) && episodes > 0
    ? `${episodes} эп.`
    : null;
}
