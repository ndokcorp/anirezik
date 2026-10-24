export function ageLabel(value: string | null | undefined) {
  return value && ['G', 'PG', 'PG-13', 'R-17', 'R+', 'Rx'].includes(value) ? value : null;
}
export function episodeLabel(type: string, episodes: number | null | undefined) {
  if (type === 'Фильм') return 'Фильм';
  return typeof episodes === 'number' && Number.isInteger(episodes) && episodes > 0
    ? `${episodes} эп.`
    : null;
}
