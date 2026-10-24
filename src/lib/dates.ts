export function displayDate(value: string | null): string {
  if (!value) return '—';
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-');
    return `${month}.${year}`;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' })
    : '—';
}
